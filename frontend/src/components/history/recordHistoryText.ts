import { DASH } from '../workspace/relations/helpers';
import { formatAmount } from '../../i18n/formatters';
import type { Translate } from '../../lib/audit/auditLogLabels';
import { formatAuditValue, isPlainObject } from '../../lib/audit/auditLogValues';

/**
 * The words of a record history entry: who wrote it, what it was, and what changed, from the
 * generic answer of `GET /records/:table/:id/history`. Pure helpers, tested alone; the component
 * (`RecordHistory.tsx`) only draws the lines they return.
 *
 * The service resolves every reference before it answers: a field value is a scalar, a visible
 * reference (`{ kind, id, label, reference }`) or a hidden one (`{ hidden, kind }`). No id is ever
 * shown here: a hidden or nameless reference reads as a record of its kind ("a contract"), and an
 * unknown object stays out instead of becoming JSON.
 */

export type RecordHistoryActorKind = 'user' | 'system' | 'import' | 'assistant';
export type RecordHistoryActor = { kind: RecordHistoryActorKind; name: string | null };
export type RecordHistoryReference = {
  kind: string;
  id: string;
  label: string | null;
  reference?: string | null;
};
export type RecordHistoryHiddenReference = { hidden: true; kind: string };
export type RecordHistoryChange = {
  field: string;
  before?: unknown;
  after?: unknown;
  event?: 'added' | 'removed';
  year?: number;
  column?: string;
  sourceYear?: number;
  sourceColumn?: string;
  overwrite?: boolean;
  percentageIncrease?: string;
  monthlyOnly?: boolean;
  months?: string[];
  wholeYear?: boolean;
  dimension?: string | null;
  changed?: boolean;
};
export type RecordHistorySubject = {
  kind: 'record' | 'version' | 'amounts' | 'allocations' | 'round_input' | 'link' | 'attachment'
    | 'contact' | 'application' | 'technology' | 'asset' | 'contract' | 'project' | 'request' | 'task' | 'metrics';
  label?: string | null;
};
export type RecordHistoryItem = {
  id: string;
  at: string;
  action: string;
  actor: RecordHistoryActor;
  subject: RecordHistorySubject;
  changes: RecordHistoryChange[];
};
export type RecordHistoryPage = { items: RecordHistoryItem[]; nextCursor: string | null };

export type HistoryTextContext = { t: Translate; locale: string; /** The audited table, for the enumerations that follow it. */ table?: string };

/** One drawn line: a full sentence, or a label and its value(s). */
export type HistoryLine = {
  label?: string;
  text?: string;
  before?: string;
  after?: string;
  /** Parenthesised details after the values ("copied from 2025"). */
  suffix?: string[];
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The budget columns, named as the Budget tab names them (`ops:operations.budgetColumns.*`). */
const MEASURE_LABEL_KEYS: Readonly<Record<string, string>> = {
  planned: 'ops:operations.budgetColumns.budget',
  committed: 'ops:operations.budgetColumns.revision',
  forecast: 'ops:operations.budgetColumns.forecast',
  actual: 'ops:operations.budgetColumns.followUp',
  expected_landing: 'ops:operations.budgetColumns.landing',
};

/** Child fields the service writes as an added or removed reference. */
const EVENT_KINDS = new Set([
  'link', 'attachment', 'contact', 'application', 'technology', 'asset', 'contract', 'project', 'request', 'task', 'line',
]);

/** The noun a nameless record reads as, by the kind the service gives it. */
const UNNAMED_KINDS = [
  'record', 'version', 'amounts', 'allocations', 'round_input', 'link', 'attachment', 'contact',
  'application', 'technology', 'asset', 'task', 'user', 'company', 'supplier', 'account',
  'chart_of_accounts', 'project', 'request', 'contract', 'cost_center', 'budget_line',
  'location', 'connection', 'interface', 'incident', 'department', 'business_process', 'calendar',
  'analytics_axis', 'analytics_category', 'contributor', 'line',
] as const;

export function isHiddenReference(value: unknown): value is RecordHistoryHiddenReference {
  return isPlainObject(value) && value.hidden === true && typeof value.kind === 'string';
}

export function isReference(value: unknown): value is RecordHistoryReference {
  return isPlainObject(value)
    && typeof value.kind === 'string'
    && typeof value.id === 'string'
    && !isHiddenReference(value);
}

/** The noun of a kind without a name ("a contract", "an application"), or a record's noun. */
export function unnamedRecord(kind: string | null | undefined, t: Translate): string {
  const key = `auditLogs.history.unnamed.${kind || 'record'}`;
  const value = t(key, { defaultValue: '' });
  if (value && value !== key) return value;
  return t('auditLogs.history.unnamed.record');
}

function referenceText(reference: RecordHistoryReference, t: Translate): string {
  if (reference.label && reference.reference) return `${reference.label} (${reference.reference})`;
  if (reference.label) return reference.label;
  if (reference.reference) return reference.reference;
  return unnamedRecord(reference.kind, t);
}

/** A value in words: a resolved reference, a hidden record, or the scalar formatter's text. */
export function historyValueText(value: unknown, field: string, context: HistoryTextContext): string {
  if (isHiddenReference(value)) return unnamedRecord(value.kind, context.t);
  if (isReference(value)) return referenceText(value, context.t);
  if (typeof value === 'string' && UUID_PATTERN.test(value.trim())) return unnamedRecord('record', context.t);
  // A structured value has no readable form here: never draw JSON.
  if (Array.isArray(value) && value.some((item) => item !== null && typeof item === 'object')) return DASH;
  if (isPlainObject(value)) return DASH;
  return formatAuditValue(value, field, { locale: context.locale, t: context.t, table: context.table }).text;
}

function namedValue(value: unknown, kind: string, t: Translate): string {
  if (isReference(value)) return referenceText(value, t);
  if (isHiddenReference(value)) return unnamedRecord(value.kind, t);
  // A child write may carry its own readable label, with no record reference (the assistant's
  // whole-set replacement of a line's web links).
  if (typeof value === 'string' && value.trim()) return value.trim();
  return unnamedRecord(kind, t);
}

function measureLabel(measure: string | null | undefined, t: Translate): string | null {
  const key = measure ? MEASURE_LABEL_KEYS[measure] : null;
  if (!key) return null;
  const value = t(key, { defaultValue: '' });
  return value && value !== key ? value : null;
}

function columnText(measure: string | null | undefined, t: Translate): string {
  return measureLabel(measure, t) ?? measure ?? '';
}

/**
 * The label the audit log gives a field, or the stored key when it has none. Two fields read
 * differently on one record's own screen: an account's nature is its "Used for", and a cost
 * center's owner is its "Budget holder" (elsewhere the stored names stay "Nature" and "Owner").
 */
export function historyFieldLabel(field: string, t: Translate, table?: string): string {
  if (field === 'nature' && table === 'accounts') {
    return t('auditLogs.fields.accountNature', { defaultValue: 'Used for' });
  }
  if (field === 'owner_user_id' && table === 'cost_centers') {
    return t('auditLogs.fields.costCenterOwner', { defaultValue: 'Budget holder' });
  }
  return t(`auditLogs.fields.${field}`, { defaultValue: field });
}

/**
 * The event of the record itself: Created, Updated or Deleted. A child's technical action is never
 * shown (its title or its event line says what happened); an unknown action keeps the audit log's
 * own label, and a missing history label falls back to it.
 */
export function historyActionText(action: string, t: Translate): string {
  const code = String(action ?? '').trim().toLowerCase();
  if (!code) return '';
  const historyLabel = t(`auditLogs.history.actions.${code}`, { defaultValue: '' });
  if (historyLabel && historyLabel !== `auditLogs.history.actions.${code}`) return historyLabel;
  return t(`auditLogs.actions.${code}`, { defaultValue: action });
}

export function historyActorText(actor: RecordHistoryActor, t: Translate): string {
  switch (actor.kind) {
    case 'system':
      return t('auditLogs.sources.system');
    case 'import':
      return t('auditLogs.sources.import');
    case 'assistant':
      return actor.name
        ? t('auditLogs.history.actors.assistantFor', { name: actor.name })
        : t('auditLogs.history.actors.assistant');
    case 'user':
    default:
      return actor.name || t('auditLogs.history.actors.unknown');
  }
}

/** The subject named beside the entry's date and author, for the children whose lines do not name it. */
export function historySubjectText(subject: RecordHistorySubject, t: Translate): string | null {
  if (subject.kind === 'version') {
    return subject.label
      ? t('auditLogs.history.version', { name: subject.label })
      : t('auditLogs.history.versionNoName');
  }
  if (subject.kind === 'round_input') {
    return subject.label
      ? t('auditLogs.history.roundInput', { column: columnText(subject.label, t) })
      : t('auditLogs.history.roundInputNoColumn');
  }
  if (subject.kind === 'allocations') {
    return subject.label
      ? t('auditLogs.history.allocation', { name: subject.label })
      : t('auditLogs.history.allocationNoName');
  }
  if (subject.kind === 'metrics') {
    return subject.label
      ? t('auditLogs.history.metricsYear', { year: subject.label })
      : t('auditLogs.history.metricsNoYear');
  }
  return null;
}

/**
 * The title line of a technical child's creation or deletion: its name and the event, with no
 * field list and no technical action ("Version Y2026 added", "Budget input Budget added").
 * A child update keeps its title in the header and its fields below, so it returns null here.
 */
export function historyChildTitle(item: RecordHistoryItem, t: Translate): string | null {
  if (item.subject.kind === 'record') return null;
  if (item.action !== 'create' && item.action !== 'delete') return null;
  if ((item.changes ?? []).length > 0) return null;
  const title = historySubjectText(item.subject, t);
  if (!title) return null;
  return t(item.action === 'create' ? 'auditLogs.history.childCreated' : 'auditLogs.history.childDeleted', { title });
}

function countText(value: unknown): string {
  if (value === null || value === undefined) return DASH;
  const number = Number(value);
  return Number.isFinite(number) ? String(number) : String(value);
}

function monthText(month: string, locale: string): string {
  const date = new Date(`${month}-01T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return month;
  return new Intl.DateTimeFormat(locale, { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(date);
}

/** The months a write touched, or the whole year, as the amount line's parenthesised detail. */
function amountScope(change: RecordHistoryChange, context: HistoryTextContext): string | null {
  if (change.wholeYear) return context.t('auditLogs.history.amountWholeYear');
  const months = (change.months ?? []).filter((month) => typeof month === 'string' && month.trim() !== '');
  if (months.length === 0) return null;
  return context.t('auditLogs.history.amountMonths', {
    months: months.map((month) => monthText(month, context.locale)).join(', '),
  });
}

function amountText(value: unknown): string {
  if (value === null || value === undefined || value === '') return DASH;
  const number = Number(value);
  return Number.isFinite(number) ? formatAmount(number) : String(value);
}

function has(object: RecordHistoryChange, key: 'before' | 'after'): boolean {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function eventLine(change: RecordHistoryChange, t: Translate): HistoryLine | null {
  if (change.event !== 'added' && change.event !== 'removed') return null;
  if (!EVENT_KINDS.has(change.field)) return null;
  const value = change.event === 'added' ? change.after : change.before;
  return {
    text: t(`auditLogs.history.events.${change.field}.${change.event}`, {
      label: namedValue(value, change.field, t),
    }),
  };
}

function dimensionLine(change: RecordHistoryChange, context: HistoryTextContext): HistoryLine {
  const name = typeof change.dimension === 'string' ? change.dimension.trim() : '';
  return {
    label: name
      ? context.t('auditLogs.history.dimension', { name })
      : context.t('auditLogs.history.dimensionNoName'),
    before: historyValueText(change.before, 'dimension', context),
    after: historyValueText(change.after, 'dimension', context),
  };
}

function amountLine(change: RecordHistoryChange, context: HistoryTextContext): HistoryLine {
  const measure = change.column && MEASURE_LABEL_KEYS[change.column] ? change.column : change.field;
  const column = columnText(measure, context.t);
  const label = typeof change.year === 'number'
    ? context.t('auditLogs.history.amountYear', { year: change.year, column })
    : context.t('auditLogs.history.amount', { column });
  if (change.monthlyOnly) {
    return { text: context.t('auditLogs.history.amountMonthly', { label }) };
  }
  const suffix: string[] = [];
  const scope = amountScope(change, context);
  if (scope) suffix.push(scope);
  if (change.sourceColumn || change.sourceYear) {
    const source = [columnText(change.sourceColumn, context.t), change.sourceYear]
      .filter((part) => part !== null && part !== undefined && part !== '')
      .join(' ');
    suffix.push(context.t('auditLogs.history.copiedFrom', { source }));
  }
  return {
    label,
    ...(has(change, 'before') ? { before: amountText(change.before) } : {}),
    ...(has(change, 'after') ? { after: amountText(change.after) } : {}),
    ...(suffix.length > 0 ? { suffix } : {}),
  };
}

function allocationsLine(change: RecordHistoryChange, context: HistoryTextContext): HistoryLine {
  const label = typeof change.year === 'number'
    ? context.t('auditLogs.history.allocationsYear', { year: change.year })
    : context.t('auditLogs.history.allocations');
  const before = countText(change.before);
  const after = countText(change.after);
  if (change.changed && before === after) {
    return { text: context.t('auditLogs.history.distributionChanged', { label }) };
  }
  const suffix: string[] = [];
  if (typeof change.sourceYear === 'number') {
    suffix.push(context.t('auditLogs.history.copiedFrom', { source: String(change.sourceYear) }));
  }
  if (change.overwrite) suffix.push(context.t('auditLogs.history.overwriteManual'));
  return { label, before, after, ...(suffix.length > 0 ? { suffix } : {}) };
}

/** A changed field: its label, and the side(s) the write carried, or the full sentence of an event. */
function fieldLine(change: RecordHistoryChange, context: HistoryTextContext): HistoryLine | null {
  const event = eventLine(change, context.t);
  if (event) return event;
  if (change.field === 'dimension') return dimensionLine(change, context);
  if (change.column && MEASURE_LABEL_KEYS[change.column]) return amountLine(change, context);
  // A column operation writes the measure itself, without its column context.
  if (MEASURE_LABEL_KEYS[change.field] && (has(change, 'before') || has(change, 'after'))) {
    return amountLine(change, context);
  }
  if (!has(change, 'before') && !has(change, 'after')) return null;
  return {
    label: historyFieldLabel(change.field, context.t, context.table),
    ...(has(change, 'before') ? { before: historyValueText(change.before, change.field, context) } : {}),
    ...(has(change, 'after') ? { after: historyValueText(change.after, change.field, context) } : {}),
  };
}

function roundInputLine(change: RecordHistoryChange, context: HistoryTextContext): HistoryLine | null {
  if (change.field === 'line') return eventLine(change, context.t);
  if (change.field === 'lines') {
    const label = historyFieldLabel('lines', context.t);
    const before = countText(change.before);
    const after = countText(change.after);
    if (change.changed && before === after) {
      return { text: context.t('auditLogs.history.distributionChanged', { label }) };
    }
    return { label, before, after };
  }
  return fieldLine(change, context);
}

/** Every line an entry shows, newest entry first as the service returns it. */
export function historyLines(item: RecordHistoryItem, context: HistoryTextContext): HistoryLine[] {
  const changes = item.changes ?? [];
  const lines = item.subject.kind === 'amounts'
    ? changes.map((change) => amountLine(change, context))
    : item.subject.kind === 'allocations'
      ? changes.map((change) => allocationsLine(change, context))
      : item.subject.kind === 'round_input'
        ? changes.map((change) => roundInputLine(change, context))
        : changes.map((change) => fieldLine(change, context));
  return lines.filter((line): line is HistoryLine => line !== null);
}

export const RECORD_HISTORY_UNNAMED_KINDS: readonly string[] = UNNAMED_KINDS;
