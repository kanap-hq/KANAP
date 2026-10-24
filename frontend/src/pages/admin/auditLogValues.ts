import { formatItemRef } from '../../utils/item-ref';
import { DASH } from '../../components/workspace/relations/helpers';

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

/** The business reference of the audited record (T-4, PRJ-3…), else its stored id. */
export function auditRecordRef(row: AuditPayloadRow | null | undefined): string | null {
  if (!row) return null;
  const snapshot = [row.after_json, row.before_json].find(isPlainObject);
  const type = RECORD_ITEM_TYPES[String(row.table_name || '')];
  const itemNumber = snapshot?.item_number;
  if (type && (typeof itemNumber === 'number' || typeof itemNumber === 'string') && itemNumber !== '' && Number.isFinite(Number(itemNumber))) {
    return formatItemRef(type, Number(itemNumber));
  }
  return row.record_id ?? null;
}

/** The text of a cell for a value, before the readable-value rules of the detail dialog. */
export function formatAuditValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return DASH;
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}
