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

import type { RecordHistoryActor } from './recordHistoryActor';

export type { RecordHistoryActor, RecordHistoryActorKind } from './recordHistoryActor';
export type RecordHistoryReference = {
  kind: string;
  id: string;
  label: string | null;
  reference?: string | null;
};
export type RecordHistoryHiddenReference = { hidden: true; kind: string; /** The row no longer exists (not merely withheld). */ deleted?: boolean };
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
  /** A fixed word standing for the change of a hidden value (a document body): `contentChanged`. */
  text?: string;
};
export type RecordHistorySubject = {
  kind: 'record' | 'version' | 'amounts' | 'allocations' | 'round_input' | 'link' | 'attachment'
    | 'contact' | 'application' | 'technology' | 'asset' | 'contract' | 'project' | 'request' | 'task' | 'metrics' | 'value'
    | 'relation' | 'member' | 'hardware' | 'support' | 'technology_version' | 'owner' | 'vulnerability'
    | 'supplier' | 'budget_line'
    | 'sub_item' | 'leg' | 'set' | 'binding' | 'person';
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
  'link', 'attachment', 'contact', 'application', 'technology', 'asset', 'contract', 'project', 'request', 'task', 'line', 'value',
  'supplier', 'budget_line', 'relation_contains', 'relation_depends_on', 'member', 'owner_it', 'owner_business', 'operating_system',
  'sub_item', 'person', 'owner', 'company', 'dependency', 'country', 'key_identifier', 'interface_leg',
  'mapping_set', 'middleware',
]);

/** The noun a nameless record reads as, by the kind the service gives it. */
const UNNAMED_KINDS = [
  'record', 'version', 'amounts', 'allocations', 'round_input', 'link', 'attachment', 'contact',
  'application', 'technology', 'asset', 'task', 'user', 'company', 'supplier', 'account',
  'chart_of_accounts', 'project', 'request', 'contract', 'cost_center', 'budget_line',
  'location', 'sub_location', 'connection', 'interface', 'incident', 'department', 'business_process', 'calendar',
  'analytics_axis', 'analytics_category', 'contributor', 'line',
  'document', 'document_folder', 'document_library', 'document_type',
  'relation', 'member', 'hardware', 'support', 'technology_version', 'owner', 'vulnerability',
  'sub_item', 'leg', 'set', 'binding', 'person',
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

/** A reference whose row no longer exists: "a deleted asset", never the "an asset" of a withheld one. */
export function deletedRecord(kind: string | null | undefined, t: Translate): string {
  const key = `auditLogs.history.deleted.${kind || 'record'}`;
  const value = t(key, { defaultValue: '' });
  if (value && value !== key) return value;
  return t('auditLogs.history.deleted.record');
}

function referenceText(reference: RecordHistoryReference, t: Translate, table?: string): string {
  // A connection's path segment is a hop on its screen ("Hop 2"); an interface's is a leg.
  if (reference.kind === 'leg' && reference.label) {
    return table === 'connections'
      ? t('auditLogs.history.hop', { index: reference.label })
      : t('auditLogs.history.segment', { index: reference.label });
  }
  if (reference.label && reference.reference) return `${reference.label} (${reference.reference})`;
  if (reference.label) return reference.label;
  if (reference.reference) return reference.reference;
  return unnamedRecord(reference.kind, t);
}

/** A value in words: a resolved reference, a hidden record, or the scalar formatter's text. */
export function historyValueText(value: unknown, field: string, context: HistoryTextContext): string {
  if (isHiddenReference(value)) return value.deleted ? deletedRecord(value.kind, context.t) : unnamedRecord(value.kind, context.t);
  if (isReference(value)) return referenceText(value, context.t, context.table);
  if (typeof value === 'string' && UUID_PATTERN.test(value.trim())) return unnamedRecord('record', context.t);
  // A structured value has no readable form here: never draw JSON.
  if (Array.isArray(value) && value.some((item) => item !== null && typeof item === 'object')) return DASH;
  if (isPlainObject(value)) return DASH;
  return formatAuditValue(value, field, { locale: context.locale, t: context.t, table: context.table }).text;
}

function namedValue(value: unknown, kind: string, t: Translate): string {
  if (isReference(value)) return referenceText(value, t);
  if (isHiddenReference(value)) return value.deleted ? deletedRecord(value.kind, t) : unnamedRecord(value.kind, t);
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
  // The IT screens name these two fields themselves ("Data class" / "Data category", and the
  // French "Classification des données"): the history reads the same label as the page.
  if (field === 'data_class' && (table === 'interfaces' || table === 'connections')) {
    // Both pages label it `workspace.connection.compliance.dataClass` ("Data class", French
    // "Classification des données").
    return t('it:workspace.connection.compliance.dataClass', { defaultValue: 'Data class' });
  }
  if (field === 'data_category' && table === 'interfaces') {
    return t('it:workspace.interface.fields.dataCategory', { defaultValue: 'Data category' });
  }
  if (field === 'owner_user_id' && table === 'cost_centers') {
    return t('auditLogs.fields.costCenterOwner', { defaultValue: 'Budget holder' });
  }
  return t(`auditLogs.fields.${field}`, { defaultValue: field });
}

export { historyActionText, historyActorText } from './recordHistoryActor';

/** The subject named beside the entry's date and author, for the children whose lines do not name it. */
export function historySubjectText(subject: RecordHistorySubject, t: Translate, table?: string): string | null {
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
  if (subject.kind === 'value') {
    return subject.label ? t('auditLogs.history.value', { name: subject.label }) : null;
  }
  if (subject.kind === 'technology_version') {
    return subject.label
      ? t('auditLogs.history.version', { name: subject.label })
      : t('auditLogs.history.versionNoName');
  }
  if (subject.kind === 'hardware') return t('auditLogs.history.hardware');
  if (subject.kind === 'support') return t('auditLogs.history.support');
  if (subject.kind === 'vulnerability') {
    return subject.label
      ? t('auditLogs.history.vulnerability', { cve: subject.label })
      : t('auditLogs.history.vulnerabilityNoName');
  }
  if (subject.kind === 'sub_item') {
    return subject.label ? t('auditLogs.history.subItem', { name: subject.label }) : null;
  }
  if (subject.kind === 'leg' || subject.kind === 'set') {
    if (!subject.label) return null;
    return table === 'connections'
      ? t('auditLogs.history.hop', { index: subject.label })
      : t('auditLogs.history.segment', { index: subject.label });
  }
  if (subject.kind === 'binding') {
    return subject.label ? t('auditLogs.history.binding', { environment: subject.label }) : null;
  }
  if (subject.kind === 'person') {
    return subject.label || null;
  }
  return null;
}

/**
 * The title line of a technical child's creation or deletion: its name and the event, with no
 * field list and no technical action ("Version Y2026 added", "Budget input Budget added").
 * A child update keeps its title in the header and its fields below, so it returns null here.
 */
export function historyChildTitle(item: RecordHistoryItem, t: Translate, table?: string): string | null {
  if (item.subject.kind === 'record') return null;
  if (item.action !== 'create' && item.action !== 'delete') return null;
  // A hardware or support sheet is masculine in French: its title has its own words.
  if (item.subject.kind === 'hardware' || item.subject.kind === 'support') {
    const kind = item.subject.kind === 'hardware' ? 'hardware' : 'support';
    return t(item.action === 'create' ? `auditLogs.history.${kind}Created` : `auditLogs.history.${kind}Deleted`);
  }
  if ((item.changes ?? []).length > 0) return null;
  // A segment and a binding name their own gender in each language: the generic "{{title}} added"
  // would read "Segment 2 ajoutée" in French.
  if (item.subject.kind === 'leg' && item.subject.label) {
    if (table === 'connections') {
      return t(item.action === 'create' ? 'auditLogs.history.hopCreated' : 'auditLogs.history.hopDeleted', {
        index: item.subject.label,
      });
    }
    return t(item.action === 'create' ? 'auditLogs.history.legCreated' : 'auditLogs.history.legDeleted', {
      index: item.subject.label,
    });
  }
  if (item.subject.kind === 'binding' && item.subject.label) {
    return t(item.action === 'create' ? 'auditLogs.history.bindingCreated' : 'auditLogs.history.bindingDeleted', {
      environment: item.subject.label,
    });
  }
  const title = historySubjectText(item.subject, t, table);
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
  // A hidden value speaks through its word: a document body changed, never its text.
  if (change.text) {
    return {
      text: context.t(`auditLogs.history.texts.${change.text}`, { defaultValue: change.text }),
    };
  }
  // A document's version numbers read as versions, not as a counter.
  if (change.field === 'current_version_number') {
    const before = has(change, 'before') ? change.before : undefined;
    const after = has(change, 'after') ? change.after : undefined;
    if (before !== undefined && after !== undefined) {
      return { text: context.t('auditLogs.history.versionChanged', { before: String(before), after: String(after) }) };
    }
    const number = after ?? before;
    return { text: context.t('auditLogs.history.versionNumber', { number: String(number) }) };
  }
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
