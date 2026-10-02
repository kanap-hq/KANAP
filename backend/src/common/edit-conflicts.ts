import { BadRequestException, ConflictException, HttpStatus } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { validate as isUuid } from 'uuid';

/**
 * Field-level edit conflicts of a PATCH (plan planning/perf-scale, lot 3C,
 * decisions D2 and D3). Shared by every entity that adopts it; the OPEX and
 * CAPEX line update is the first (`spend/item-locked-update.ts`).
 *
 * Contract:
 * - The PATCH body is unchanged, plus one optional reserved key, `base`: per
 *   changed field, the value the user started from (the value the screen
 *   showed when the edit began). A request without `base` behaves as before:
 *   nothing is compared.
 * - Under the record's row lock, each field that the request changes AND
 *   that carries a base is compared with the stored value
 *   ({@link sameFieldValue}). A field differs when someone else changed it
 *   since the user's screen read it. Two edits of different fields never
 *   conflict (D2): only the fields of this request are compared.
 * - A field whose stored value already equals the requested one is no
 *   conflict either (two people made the same change): the write goes on.
 * - Any conflict refuses the whole request: 409 `edit_conflict`, with one
 *   entry per conflicting field (base, current, mine, who changed it and
 *   when, read from the audit trail) and the record's current `row_version`.
 *   Nothing is written, the non-conflicting fields of the same request
 *   included: one request is one action of the user (a company and the
 *   account it clears, an end of validity and its status), applying part of
 *   it could leave a combination nobody chose, and the client then knows
 *   exactly what is saved (nothing). It keeps every field pending and sends
 *   them again once the user has chosen, field by field (D3).
 */

export const EDIT_CONFLICT_CODE = 'edit_conflict';

/** The reserved key of a PATCH body that carries the values the edit started from. */
export const EDIT_BASE_KEY = 'base';

export type EditBase = Record<string, unknown>;

/** The body without its `base`, and the base (null when the request carries none). */
export function splitEditBase(body: unknown): { changes: Record<string, unknown>; base: EditBase | null } {
  const input: Record<string, unknown> = body && typeof body === 'object' && !Array.isArray(body) ? { ...(body as Record<string, unknown>) } : {};
  const base = input[EDIT_BASE_KEY];
  delete input[EDIT_BASE_KEY];
  if (base === undefined || base === null) return { changes: input, base: null };
  if (typeof base !== 'object' || Array.isArray(base)) {
    throw new BadRequestException('base must map each changed field to the value the edit started from.');
  }
  return { changes: input, base: base as EditBase };
}

/** Whether the base names this key (a base may say a field was empty: null). */
export function hasBase(base: EditBase | null | undefined, key: string): boolean {
  return !!base && Object.prototype.hasOwnProperty.call(base, key) && base[key] !== undefined;
}

const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/i;

function blankToNull(value: unknown): unknown {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string') {
    const text = value.trim();
    return text === '' ? null : text;
  }
  if (value instanceof Date && Number.isNaN(value.getTime())) return null;
  return value;
}

function instantOf(value: unknown): number | null {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'string') {
    const time = Date.parse(value);
    return Number.isNaN(time) ? null : time;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return null;
}

function numberOf(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'string' && /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(value)) return Number(value);
  return null;
}

function booleanOf(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return null;
}

/** JSON with sorted object keys, so two equal objects compare equal whatever their key order. */
function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, inner) => (
    inner && typeof inner === 'object' && !Array.isArray(inner) && !(inner instanceof Date)
      ? Object.fromEntries(Object.keys(inner).sort().map((key) => [key, (inner as Record<string, unknown>)[key]]))
      : inner
  ));
}

/**
 * Type-aware equality of a stored value and a value from a request (JSON).
 * Started as the AI preview's `sameValue` (ai-business-record-mutation-support),
 * which now uses this one:
 * - null, undefined and a blank text are the same (empty); texts compare trimmed;
 * - a Date compares as an instant with a Date or a date string
 *   (`2026-10-02T12:02:00.000Z` and `2026-10-02T14:02:00+02:00` are equal);
 *   two ISO timestamps compare as instants too; a calendar date
 *   (`2026-10-02`, a `date` column) compares as text;
 * - a number compares numerically with a number or a numeric text (a
 *   `numeric` column comes back from PostgreSQL as text: `12.50` equals 12.5);
 * - two uuids compare without case;
 * - a boolean with a boolean or `true` / `false`;
 * - objects and arrays by their JSON, keys sorted.
 */
export function sameFieldValue(left: unknown, right: unknown): boolean {
  const a = blankToNull(left);
  const b = blankToNull(right);
  if (a === null || b === null) return a === b;
  if (a instanceof Date || b instanceof Date) {
    const x = instantOf(a);
    return x !== null && x === instantOf(b);
  }
  if (typeof a === 'number' || typeof b === 'number' || typeof a === 'bigint' || typeof b === 'bigint') {
    const x = numberOf(a);
    return x !== null && x === numberOf(b);
  }
  if (typeof a === 'boolean' || typeof b === 'boolean') {
    const x = booleanOf(a);
    return x !== null && x === booleanOf(b);
  }
  if (typeof a === 'string' && typeof b === 'string') {
    if (a === b) return true;
    if (isUuid(a) && isUuid(b)) return a.toLowerCase() === b.toLowerCase();
    if (ISO_INSTANT.test(a) && ISO_INSTANT.test(b)) {
      const x = instantOf(a);
      return x !== null && x === instantOf(b);
    }
    return false;
  }
  return stableJson(a) === stableJson(b);
}

/** One field the request changes and carries a base for. */
export type EditedField = {
  /** The name the client knows the field by (`supplier_id`, `analytics_values.<dimension id>`). */
  field: string;
  base: unknown;
  /** The stored value, read under the row lock. */
  current: unknown;
  /** The value the request writes. */
  mine: unknown;
  /** Where the field sits in the audit rows' JSON (`['supplier_id']`, `['analytics_values', '<id>']`). */
  auditPath: string[];
  /** The field's own equality, when {@link sameFieldValue} is not enough (a code compared without case). */
  same?: (left: unknown, right: unknown) => boolean;
};

export type EditConflictAuthor = { id: string; name: string };

/** A conflicting field, as the 409 answers it. */
export type EditConflict = {
  field: string;
  base: unknown;
  current: unknown;
  mine: unknown;
  /** Display names of id values (a supplier's name for its id), when the entity provides them; null for other values. */
  labels: { base: string | null; current: string | null; mine: string | null };
  /** Who wrote the current value, null when the audit trail cannot say (a referenced row deleted, a script). */
  changed_by: EditConflictAuthor | null;
  /** When, ISO timestamp, null when unknown. */
  changed_at: string | null;
};

/**
 * The fields that conflict: the stored value is no longer the base, and is
 * not already the requested value.
 */
export function conflictingFields(fields: EditedField[]): EditedField[] {
  return fields.filter((entry) => {
    const same = entry.same ?? sameFieldValue;
    return !same(entry.current, entry.base) && !same(entry.current, entry.mine);
  });
}

type AuditAuthorRow = { field: string; user_id: string | null; created_at: Date | string | null; after_value: unknown };

/**
 * Who wrote each field's current value, and when: the latest audit row of
 * the record that changed the field and left the current value (one query,
 * `idx_audit_log_tenant_record_created`). A value no audit row explains was
 * written outside the audit trail (a referenced row deleted, `ON DELETE SET
 * NULL`; a script): nobody is named, and the time is `fallbackAt` (the
 * record's `updated_at`). Naming the record's last editor instead would
 * accuse someone who never touched the field.
 */
export async function lastFieldChanges(
  manager: EntityManager,
  opts: { tenantId: string; table: string; recordId: string; fields: EditedField[]; fallbackAt?: Date | string | null },
): Promise<Map<string, { changed_by: EditConflictAuthor | null; changed_at: string | null }>> {
  const result = new Map<string, { changed_by: EditConflictAuthor | null; changed_at: string | null }>();
  if (opts.fields.length === 0) return result;
  const rows: AuditAuthorRow[] = await manager.query(
    `SELECT f.field, a.user_id::text AS user_id, a.created_at, a.after_value
       FROM unnest($4::text[], $5::text[]) AS f(field, path)
       LEFT JOIN LATERAL (
         SELECT l.user_id, l.created_at, l.after_json #> f.path::text[] AS after_value
           FROM audit_log l
          WHERE l.tenant_id = $1 AND l.table_name = $2 AND l.record_id = $3
            AND (l.before_json #> f.path::text[]) IS DISTINCT FROM (l.after_json #> f.path::text[])
          ORDER BY l.created_at DESC
          LIMIT 1
       ) a ON true`,
    [
      opts.tenantId,
      opts.table,
      opts.recordId,
      opts.fields.map((entry) => entry.field),
      // A text[] literal per field; the path parts are column names and uuids.
      opts.fields.map((entry) => `{${entry.auditPath.map((part) => `"${part.replace(/["\\]/g, '')}"`).join(',')}}`),
    ],
  );
  const byField = new Map(rows.map((row) => [row.field, row]));

  const picked = new Map<string, { user_id: string | null; created_at: Date | string | null }>();
  for (const entry of opts.fields) {
    const row = byField.get(entry.field);
    // The row explains the current value only if it wrote it.
    picked.set(entry.field, row?.created_at && (entry.same ?? sameFieldValue)(row.after_value, entry.current)
      ? row
      : { user_id: null, created_at: opts.fallbackAt ?? null });
  }

  const names = await userNames(manager, opts.tenantId, Array.from(picked.values()).map((row) => row.user_id));
  for (const [field, row] of picked) result.set(field, authorAt(names, row.user_id, row.created_at));
  return result;
}

/** The display names of users of the tenant, by id (one query; an unknown id is left out). */
export async function userNames(manager: EntityManager, tenantId: string, ids: ReadonlyArray<string | null | undefined>): Promise<Map<string, string>> {
  const userIds = Array.from(new Set(ids.filter((id): id is string => !!id)));
  const names = new Map<string, string>();
  if (userIds.length === 0) return names;
  const users: Array<{ id: string; first_name: string | null; last_name: string | null; email: string | null }> = await manager.query(
    `SELECT id::text AS id, first_name, last_name, email FROM users WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
    [tenantId, userIds],
  );
  for (const user of users) names.set(user.id, displayName(user));
  return names;
}

/** Who and when, as a conflict answers it: nobody when the user is unknown, no time when there is none. */
export function authorAt(
  names: ReadonlyMap<string, string>,
  userId: string | null | undefined,
  at: Date | string | null | undefined,
): { changed_by: EditConflictAuthor | null; changed_at: string | null } {
  const name = userId ? names.get(userId) : undefined;
  return {
    changed_by: userId && name ? { id: userId, name } : null,
    changed_at: at ? new Date(at).toISOString() : null,
  };
}

/** A user's name as the pickers show it: first and last name, else the e-mail. */
export function displayName(user: { first_name?: string | null; last_name?: string | null; email?: string | null }): string {
  const name = [user.first_name, user.last_name].map((part) => (part ?? '').trim()).filter(Boolean).join(' ');
  return name || (user.email ?? '').trim();
}

export class EditConflictException extends ConflictException {
  constructor(readonly conflicts: EditConflict[], readonly rowVersion: number | null) {
    super({
      statusCode: HttpStatus.CONFLICT,
      error: 'Conflict',
      code: EDIT_CONFLICT_CODE,
      message: 'Someone else changed this field while you were editing it. Choose which value to keep.',
      conflicts,
      row_version: rowVersion,
    });
  }
}

/**
 * Compares the fields and refuses the request when one conflicts (see the
 * file header). Call it under the record's row lock, before any write.
 * `labelsFor` names id values for the answer (the entity's own references).
 */
export async function assertNoEditConflicts(
  manager: EntityManager,
  opts: {
    tenantId: string;
    table: string;
    recordId: string;
    fields: EditedField[];
    rowVersion: number | null;
    fallbackAt?: Date | string | null;
    labelsFor?: (conflicts: EditedField[]) => Promise<Map<string, EditConflict['labels']>>;
  },
): Promise<void> {
  const conflicts = conflictingFields(opts.fields);
  if (conflicts.length === 0) return;
  // One after the other: both run on the request's connection.
  const authors = await lastFieldChanges(manager, {
    tenantId: opts.tenantId, table: opts.table, recordId: opts.recordId, fields: conflicts, fallbackAt: opts.fallbackAt,
  });
  const labels = opts.labelsFor ? await opts.labelsFor(conflicts) : new Map<string, EditConflict['labels']>();
  throw new EditConflictException(
    conflicts.map((entry) => ({
      field: entry.field,
      base: entry.base ?? null,
      current: entry.current ?? null,
      mine: entry.mine ?? null,
      labels: labels.get(entry.field) ?? { base: null, current: null, mine: null },
      changed_by: authors.get(entry.field)?.changed_by ?? null,
      changed_at: authors.get(entry.field)?.changed_at ?? null,
    })),
    opts.rowVersion,
  );
}
