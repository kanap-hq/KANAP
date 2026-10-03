import React, { useCallback, useSyncExternalStore } from 'react';

/**
 * Field-level edit conflicts (plan planning/perf-scale, lot 3C, decisions D2
 * and D3), the client side of the backend contract in
 * `backend/src/common/edit-conflicts.ts`:
 * - a PATCH carries, per changed field, the value the user's edit started
 *   from (`base`, captured when the edit began: see `PatchBuffer.add`);
 * - a field someone else changed meanwhile answers 409 `edit_conflict`, the
 *   whole request refused, with one entry per conflicting field;
 * - the edit is kept, not retried and not dropped (`PatchBuffer.park`), until
 *   the user chooses per field: keep their value (the field is dropped from
 *   the pending edit) or apply theirs (`base` becomes their value and the edit
 *   goes again). `EditConflictBanner` shows the choice;
 * - while it waits, the edit is never sent with another one: an edit of
 *   another field goes alone (the server checks a request before it compares
 *   it, so a refusal of that other field would drop the waiting one too), an
 *   edit of a waiting field joins it and waits (lot 3C review).
 */

export const EDIT_CONFLICT_CODE = 'edit_conflict';

/**
 * Who changed a value: a user of the tenant. `name` is their first and last name, null when they
 * have none (the screens say "a user"; never the e-mail).
 */
export type EditConflictAuthor = { id: string; name: string | null };

/** The author of an answer (a conflict, a record's meta): a user id, with a name or none. */
export function authorOf(value: unknown): EditConflictAuthor | null {
  const author = value as { id?: unknown; name?: unknown } | null | undefined;
  if (!author || typeof author !== 'object' || typeof author.id !== 'string' || author.id === '') return null;
  return { id: author.id, name: typeof author.name === 'string' && author.name.trim() !== '' ? author.name : null };
}

export type EditConflict = {
  /** The field as the server names it: `notes`, `supplier_id`, `analytics_values.<dimension id>`. */
  field: string;
  /** The value the edit started from. */
  base: unknown;
  /** The stored value: theirs. */
  current: unknown;
  /** The value the refused request sent. */
  mine: unknown;
  /** Names of id values (a supplier's name), null for other values. */
  labels: { base: string | null; current: string | null; mine: string | null };
  /** Who wrote the stored value, null when the server cannot say. */
  changed_by: EditConflictAuthor | null;
  /** When, ISO timestamp, null when unknown. */
  changed_at: string | null;
  /**
   * Client side: the user changed the field again after the server's answer;
   * `mine` is that newer value, which the server never named (`labels.mine`
   * null unless it is their value or the base).
   */
  mineEdited?: boolean;
};

export type ConflictChoice = 'theirs' | 'mine';

function textOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

/** The conflicts of a 409 `edit_conflict` answer, or null for any other error (or an answer without conflicts). */
export function editConflictsOf(error: unknown): EditConflict[] | null {
  const response = (error as { response?: { status?: number; data?: { code?: unknown; conflicts?: unknown } } } | null)?.response;
  if (response?.status !== 409 || response.data?.code !== EDIT_CONFLICT_CODE) return null;
  const raw = Array.isArray(response.data.conflicts) ? response.data.conflicts : [];
  const conflicts = raw
    .filter((entry): entry is Record<string, any> => !!entry && typeof entry === 'object' && typeof entry.field === 'string' && entry.field !== '')
    .map((entry) => ({
      field: entry.field as string,
      base: entry.base ?? null,
      current: entry.current ?? null,
      mine: entry.mine ?? null,
      labels: {
        base: textOrNull(entry.labels?.base),
        current: textOrNull(entry.labels?.current),
        mine: textOrNull(entry.labels?.mine),
      },
      changed_by: authorOf(entry.changed_by),
      changed_at: textOrNull(entry.changed_at),
    }));
  return conflicts.length > 0 ? conflicts : null;
}

export function isEditConflict(error: unknown): boolean {
  return editConflictsOf(error) !== null;
}

/* ---- Paths in a patch: `notes`, or one nested level, `analytics_values.<id>` ---- */

type AnyRecord = Record<string, unknown>;

function splitPath(path: string): [string, string | null] {
  const dot = path.indexOf('.');
  return dot < 0 ? [path, null] : [path.slice(0, dot), path.slice(dot + 1)];
}

const isRecord = (value: unknown): value is AnyRecord => !!value && typeof value === 'object' && !Array.isArray(value);

export function getPath(patch: object, path: string): unknown {
  const [key, inner] = splitPath(path);
  const value = (patch as AnyRecord)[key];
  if (inner === null) return value;
  return isRecord(value) ? value[inner] : undefined;
}

export function hasPath(patch: object, path: string): boolean {
  const [key, inner] = splitPath(path);
  const value = (patch as AnyRecord)[key];
  if (inner === null) return key in patch;
  return isRecord(value) && inner in value;
}

/** The patch without the path (a nested object left empty goes too). */
export function omitPath<P extends object>(patch: P, path: string): P {
  const [key, inner] = splitPath(path);
  const record = patch as AnyRecord;
  if (!(key in record)) return patch;
  const { [key]: value, ...rest } = record;
  if (inner === null) return rest as P;
  if (!isRecord(value) || !(inner in value)) return patch;
  const { [inner]: _dropped, ...nested } = value;
  return (Object.keys(nested).length > 0 ? { ...rest, [key]: nested } : rest) as P;
}

export function setPath<P extends object>(patch: P, path: string, next: unknown): P {
  const [key, inner] = splitPath(path);
  const record = patch as AnyRecord;
  if (inner === null) return { ...record, [key]: next } as P;
  const nested = isRecord(record[key]) ? (record[key] as AnyRecord) : {};
  return { ...record, [key]: { ...nested, [inner]: next } } as P;
}

/** The values of `source` for the paths `shape` holds (top-level keys, and the keys of nested objects). */
export function pickLike<P extends object>(source: P, shape: object): P {
  const result: AnyRecord = {};
  for (const [key, value] of Object.entries(shape as AnyRecord)) {
    if (!(key in (source as AnyRecord))) continue;
    const from = (source as AnyRecord)[key];
    if (isRecord(value) && isRecord(from)) {
      const nested = Object.fromEntries(Object.keys(value).filter((inner) => inner in from).map((inner) => [inner, from[inner]]));
      if (Object.keys(nested).length > 0) result[key] = nested;
    } else {
      result[key] = from;
    }
  }
  return result as P;
}

/** `source` without the paths `shape` holds (a nested object left empty goes too). */
export function omitLike<P extends object>(source: P, shape: object): P {
  let result = source;
  for (const [key, value] of Object.entries(shape as AnyRecord)) {
    if (isRecord(value) && isRecord((source as AnyRecord)[key])) {
      for (const inner of Object.keys(value)) result = omitPath(result, `${key}.${inner}`);
    } else {
      result = omitPath(result, key);
    }
  }
  return result;
}

/** No field at all (an empty nested object counts as none). */
export function isEmptyPatch(patch: object): boolean {
  return Object.values(patch as AnyRecord).every((value) => isRecord(value) && Object.keys(value).length === 0);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Two values of a field as the server compares them: an empty text is no value, texts trimmed, ids without case. */
export function sameEditValue(a: unknown, b: unknown): boolean {
  const norm = (value: unknown) => (value === undefined || value === '' ? null : value);
  const x = norm(a);
  const y = norm(b);
  if (typeof x === 'string' && typeof y === 'string') {
    return x.trim() === y.trim() || (UUID.test(x) && x.toLowerCase() === y.toLowerCase());
  }
  return JSON.stringify(x) === JSON.stringify(y);
}

/** The conflicts once the server answered again: a field it names again takes the new entry, the others stay. */
export function mergeConflicts(kept: readonly EditConflict[] | undefined, next: readonly EditConflict[]): EditConflict[] {
  const fields = new Set(next.map((conflict) => conflict.field));
  return [...(kept ?? []).filter((conflict) => !fields.has(conflict.field)), ...next];
}

/**
 * Fields kept or dropped together. "Keep their value" on one field of a group
 * also drops the user's value of the group's other fields held with it, and
 * decides their rows: a company with its account (their account belongs to
 * their company's chart of accounts), an end of validity with its status.
 */
export function conflictCompanions(field: string, waiting: object | undefined, groups: readonly (readonly string[])[]): string[] {
  if (!waiting) return [];
  const companions = new Set<string>();
  for (const group of groups) {
    if (!group.includes(field)) continue;
    for (const other of group) if (other !== field && hasPath(waiting, other)) companions.add(other);
  }
  return [...companions];
}

/* ---- Subscription ---- */

export interface EditConflictSource {
  subscribe: (listener: () => void) => () => void;
  /** The conflicts of one item; the same array until they change. */
  conflictsOf: (targetId: string) => readonly EditConflict[];
  /** The items with a choice waiting; the same array until it changes. */
  conflictTargets: () => readonly string[];
}

export const NO_CONFLICTS: readonly EditConflict[] = Object.freeze([]);
const NO_TARGETS: readonly string[] = Object.freeze([]);

/** The conflicts waiting for the user's choice on the item the page shows (re-renders when they change). */
export function useEditConflicts(source: EditConflictSource, targetId: string | null | undefined): readonly EditConflict[] {
  const getSnapshot = useCallback(() => (targetId ? source.conflictsOf(targetId) : NO_CONFLICTS), [source, targetId]);
  return useSyncExternalStore(source.subscribe, getSnapshot, getSnapshot);
}

/** The items other than `targetId` with a choice waiting (a line left another way than through the workspace). */
export function useOtherConflictTargets(source: EditConflictSource, targetId: string | null | undefined): readonly string[] {
  const targets = useSyncExternalStore(source.subscribe, source.conflictTargets, source.conflictTargets);
  return React.useMemo(() => {
    const others = targets.filter((id) => id !== targetId);
    return others.length > 0 ? others : NO_TARGETS;
  }, [targets, targetId]);
}
