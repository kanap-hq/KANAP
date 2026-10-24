import { DASH } from '../../components/workspace/relations/helpers';
import { formatShortDate, formatShortDateTime } from '../../lib/dateFormat';
import { formatItemRef } from '../../utils/item-ref';
import type { Translate } from './auditLogLabels';

/**
 * The readable face of an audit entry: the field rows the detail dialog shows, the reference of
 * the record it names, and the display text of a field value. Pure helpers, tested alone.
 */

export type AuditPayloadRow = {
  action?: string | null;
  table_name?: string | null;
  record_id?: string | null;
  before_json?: any;
  after_json?: any;
};

export type AuditFieldRow = {
  key: string;
  before?: unknown;
  after?: unknown;
  value?: unknown;
};

export type AuditFields = {
  /** `change`: one row per changed field, two value columns. `single`: one value column. */
  mode: 'change' | 'single';
  rows: AuditFieldRow[];
};

/** The text of a value cell, its full value for a tooltip, and whether it is a secondary label. */
export type AuditValue = {
  text: string;
  title?: string;
  secondary?: boolean;
};

export type AuditValueContext = {
  locale: string;
  t: Translate;
  /** The payload around the value, to read a neighbouring label (`supplier_name` for `supplier_id`). */
  snapshot?: unknown;
  /** The names of the users the dialog read in one lookup. */
  users?: ReadonlyMap<string, string>;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DATE_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const JSON_MAX_LENGTH = 120;

/** Fields that hold a person: resolved through the user lookup, never shown as an id. */
const USER_ID_FIELDS = new Set([
  'user_id',
  'updated_by',
  'owner_user_id',
  'created_by_user_id',
  'revoked_by_user_id',
]);

/** Noise that stays in the raw JSON (created_at stays in a create, where it is the record's date). */
const OMITTED_FIELDS = new Set(['id', 'tenant_id', 'updated_at']);

/** Tables whose record is named by `item_number`, and the reference prefix of each. */
const RECORD_ITEM_TYPES: Record<string, Parameters<typeof formatItemRef>[0]> = {
  documents: 'document',
  incidents: 'incident',
  portfolio_projects: 'project',
  portfolio_requests: 'request',
  portfolio_team_member_configs: 'contributor',
  spend_items: 'budget',
  tasks: 'task',
  technologies: 'technology',
};

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function omitted(key: string, action: string): boolean {
  if (OMITTED_FIELDS.has(key)) return true;
  return key === 'created_at' && action !== 'create';
}

function changedKeys(before: Record<string, unknown>, after: Record<string, unknown>): string[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return Array.from(keys).filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]));
}

/** A payload that is not an object (an array, a string…) cannot be read as fields. */
export function auditHasNonObjectPayload(row: AuditPayloadRow | null | undefined): boolean {
  if (!row) return false;
  return (row.before_json != null && !isPlainObject(row.before_json))
    || (row.after_json != null && !isPlainObject(row.after_json));
}

/** The rows of the field table: the changed keys of an update, else the fields of the one side present. */
export function auditFields(row: AuditPayloadRow | null | undefined): AuditFields {
  if (!row) return { mode: 'single', rows: [] };
  const action = String(row.action || '').toLowerCase();
  const before = isPlainObject(row.before_json) ? row.before_json : {};
  const after = isPlainObject(row.after_json) ? row.after_json : {};

  if (action === 'update') {
    return {
      mode: 'change',
      rows: changedKeys(before, after)
        .filter((key) => !omitted(key, action))
        .map((key) => ({ key, before: before[key], after: after[key] })),
    };
  }

  const source = action === 'delete'
    ? before
    : (Object.keys(after).length > 0 ? after : before);
  return {
    mode: 'single',
    rows: Object.keys(source)
      .filter((key) => !omitted(key, action))
      .map((key) => ({ key, value: source[key] })),
  };
}

/** The payload the detail reads around a value: the after side wins, the before side fills what it no longer holds. */
export function auditSnapshot(row: AuditPayloadRow | null | undefined): Record<string, unknown> {
  const before = isPlainObject(row?.before_json) ? row.before_json : {};
  const after = isPlainObject(row?.after_json) ? row.after_json : {};
  return { ...before, ...after };
}

export function isUserIdField(field: string): boolean {
  return USER_ID_FIELDS.has(field) || field.endsWith('_user_id');
}

export function isUserIdValue(field: string, value: unknown): value is string {
  return isUserIdField(field) && typeof value === 'string' && value.trim() !== '';
}

/** The people named by the field rows, for the one lookup of the dialog. */
export function auditUserIds(fields: AuditFields): string[] {
  const ids = new Set<string>();
  for (const row of fields.rows) {
    for (const value of [row.before, row.after, row.value]) {
      if (isUserIdValue(row.key, value)) ids.add(value.trim());
    }
  }
  return Array.from(ids).sort();
}

/** The business reference of the audited record (T-4, PRJ-3…), else its stored id. */
export function auditRecordRef(row: AuditPayloadRow | null | undefined): string | null {
  if (!row) return null;
  const type = RECORD_ITEM_TYPES[String(row.table_name || '')];
  for (const snapshot of [row.after_json, row.before_json]) {
    if (!isPlainObject(snapshot)) continue;
    const itemNumber = snapshot.item_number;
    if (type && (typeof itemNumber === 'number' || typeof itemNumber === 'string') && itemNumber !== '' && Number.isFinite(Number(itemNumber))) {
      return formatItemRef(type, Number(itemNumber));
    }
  }
  return row.record_id ?? null;
}

function identifier(context: AuditValueContext, id: string): AuditValue {
  return { text: context.t('auditLogs.values.identifier'), title: id, secondary: true };
}

/** A readable neighbour of an id in the same payload (`supplier_id` → `supplier_name`), if any. */
function neighbourName(snapshot: unknown, field: string): string | null {
  if (!isPlainObject(snapshot) || !field.endsWith('_id')) return null;
  const base = field.slice(0, -3);
  for (const suffix of ['_name', '_label', '_title', '_ref', '_reference', '']) {
    const value = snapshot[`${base}${suffix}`];
    if (typeof value === 'string' && value.trim() && !UUID_PATTERN.test(value.trim())) return value.trim();
  }
  return null;
}

function dateText(value: string, locale: string): string | null {
  if (DATE_ONLY_PATTERN.test(value)) return formatShortDate(value, locale) || null;
  if (DATE_TIME_PATTERN.test(value)) return formatShortDateTime(value, locale) || null;
  return null;
}

function scalarText(value: unknown, context: AuditValueContext): string {
  if (value === null || value === undefined) return DASH;
  if (typeof value === 'boolean') {
    return context.t(value ? 'auditLogs.values.yes' : 'auditLogs.values.no');
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value.toLocaleString(context.locale) : String(value);
  }
  if (typeof value === 'string') {
    const text = value.trim();
    if (!text) return DASH;
    return dateText(text, context.locale) ?? value;
  }
  return String(value);
}

function compactJson(value: unknown): string {
  try {
    const text = JSON.stringify(value);
    return typeof text === 'string' ? text : String(value);
  } catch {
    return String(value);
  }
}

function jsonValue(value: unknown): AuditValue {
  const text = compactJson(value);
  if (text.length <= JSON_MAX_LENGTH) return { text };
  return { text: `${text.slice(0, JSON_MAX_LENGTH - 1)}…`, title: text };
}

/**
 * The text of a value cell: empty marker, yes/no, short dates, locale numbers, scalar lists,
 * one-line JSON for objects, the name of a person or a readable neighbour instead of an id.
 */
export function formatAuditValue(value: unknown, field: string, context: AuditValueContext): AuditValue {
  if (value === null || value === undefined) return { text: DASH };
  if (typeof value === 'boolean') return { text: context.t(value ? 'auditLogs.values.yes' : 'auditLogs.values.no') };
  if (typeof value === 'number') {
    return { text: Number.isFinite(value) ? value.toLocaleString(context.locale) : String(value) };
  }
  if (typeof value === 'string') {
    const text = value.trim();
    if (!text) return { text: DASH };
    if (isUserIdField(field)) {
      const neighbour = neighbourName(context.snapshot, field);
      if (neighbour) return { text: neighbour };
      const name = context.users?.get(text);
      return name ? { text: name } : identifier(context, text);
    }
    const date = dateText(text, context.locale);
    if (date) return { text: date };
    if (UUID_PATTERN.test(text)) {
      const neighbour = neighbourName(context.snapshot, field);
      return neighbour ? { text: neighbour } : identifier(context, text);
    }
    return { text: value };
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return { text: DASH };
    const scalars = value.every((item) => item === null || item === undefined || ['string', 'number', 'boolean'].includes(typeof item));
    if (scalars) return { text: value.map((item) => scalarText(item, context)).join(', ') };
    return jsonValue(value);
  }
  if (typeof value === 'object') return jsonValue(value);
  return { text: String(value) };
}
