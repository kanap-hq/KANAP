import { useCallback, useSyncExternalStore } from 'react';

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
 *   goes again). `EditConflictBanner` shows the choice.
 */

export const EDIT_CONFLICT_CODE = 'edit_conflict';

export type EditConflictAuthor = { id: string; name: string };

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
      changed_by: entry.changed_by && typeof entry.changed_by.name === 'string' && entry.changed_by.name.trim()
        ? { id: String(entry.changed_by.id ?? ''), name: entry.changed_by.name as string }
        : null,
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

/* ---- Subscription ---- */

export interface EditConflictSource {
  subscribe: (listener: () => void) => () => void;
  /** The conflicts of one item; the same array until they change. */
  conflictsOf: (targetId: string) => readonly EditConflict[];
}

export const NO_CONFLICTS: readonly EditConflict[] = Object.freeze([]);

/** The conflicts waiting for the user's choice on the item the page shows (re-renders when they change). */
export function useEditConflicts(source: EditConflictSource, targetId: string | null | undefined): readonly EditConflict[] {
  const getSnapshot = useCallback(() => (targetId ? source.conflictsOf(targetId) : NO_CONFLICTS), [source, targetId]);
  return useSyncExternalStore(source.subscribe, getSnapshot, getSnapshot);
}
