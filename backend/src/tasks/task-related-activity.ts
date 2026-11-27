import type { EntityManager } from 'typeorm';
import { incidentViewerFromContext } from '../incidents/incident-visibility';
import { readableFamilies, resolveReferences, type FamilyKey, type ReferenceResolution } from '../audit/record-history/families';
import { referenceValue, type RecordHistoryHiddenReference, type RecordHistoryReference } from '../audit/record-history/presenters';
import { TASK_RELATED_FAMILIES, taskRelatedFamily } from '../audit/record-history/records/tasks';
import { isPlainObject, isUuid } from '../audit/record-history/values';

/**
 * The object a task leaves or reaches in its activity (`changed_fields.related_to`, lot I7e of
 * 26.12.1). The move stores each side as the family of the object and its id, never its name:
 * `GET /tasks/:id/activities` names it with the reader's rights, through the reference resolution
 * of the record history (`audit/record-history/families.ts`), as the task's History names the same
 * change ("Belongs to: PRJ-3"). A person who reads the object gets its label and reference; one who
 * does not read its module, or whose data access or participation leaves it out, gets its kind
 * alone, `{ hidden: true, kind }`, with neither name, reference nor id.
 *
 * Older rows stored a text (the name or reference the author read, or an id). They show the kind
 * the text tells, or `{ hidden: true }` when it tells none, to every reader: the stored text never
 * leaves the server, and the object it named then is not looked up again.
 */
export type StoredRelatedObject = { kind: FamilyKey; id: string };

export type RelatedObjectSide = RecordHistoryReference | RecordHistoryHiddenReference | { hidden: true } | null;

const RELATED_KINDS = new Set<string>(Object.values(TASK_RELATED_FAMILIES));

/** One side of a move as stored: the family of the task's object and its id, or null (no object). */
export function storedRelatedObject(type: unknown, id: unknown): StoredRelatedObject | null {
  const kind = taskRelatedFamily(type);
  return kind && isUuid(id) ? { kind, id: id.toLowerCase() } : null;
}

function asStored(side: unknown): StoredRelatedObject | null {
  if (!isPlainObject(side)) return null;
  const { kind, id } = side as Record<string, unknown>;
  return typeof kind === 'string' && RELATED_KINDS.has(kind) && isUuid(id)
    ? { kind: kind as FamilyKey, id: id.toLowerCase() }
    : null;
}

/** The texts older moves stored, by the kind each one tells (`resolveRelatedObjectName` before lot I7e). */
const LEGACY_KINDS: ReadonlyArray<[RegExp, FamilyKey]> = [
  [/^PRJ-\d+: /, 'project'],
  [/^(Spend|CAPEX): /, 'budget_line'],
  [/^A budget line$/, 'budget_line'],
  [/^Contract: /, 'contract'],
  [/^A contract$/, 'contract'],
  [/^INC-\d+/, 'incident'],
];

function legacySide(text: string): RecordHistoryHiddenReference | { hidden: true } {
  const kind = LEGACY_KINDS.find(([pattern]) => pattern.test(text))?.[1];
  return kind ? { hidden: true, kind } : { hidden: true };
}

type ActivityRow = { changed_fields: Record<string, [unknown, unknown]> | null };

/** The person reading a task's activity: the request transaction, the tenant and their rights. */
export type TaskActivityReader = {
  manager: EntityManager;
  tenantId: string;
  userId: string | null | undefined;
  isAdmin?: boolean;
  permissions?: Record<string, string>;
};

/** The activities with each side of a move named for `reader`; the other rows unchanged. */
export async function withRelatedObjectsForReader<T extends ActivityRow>(rows: T[], reader: TaskActivityReader): Promise<T[]> {
  const moves = rows.filter((row) => Array.isArray(row.changed_fields?.related_to));
  if (moves.length === 0) return rows;

  const ids = new Map<FamilyKey, Set<string>>();
  for (const row of moves) {
    for (const side of row.changed_fields!.related_to) {
      const stored = asStored(side);
      if (stored) ids.set(stored.kind, (ids.get(stored.kind) ?? new Set()).add(stored.id));
    }
  }
  const readable = readableFamilies({ isAdmin: reader.isAdmin === true, permissions: reader.permissions });
  // No person: nothing is named (every side by its kind).
  const resolution: ReferenceResolution = reader.userId && ids.size > 0
    ? await resolveReferences({
      manager: reader.manager,
      tenantId: reader.tenantId,
      userId: reader.userId,
      isAdmin: reader.isAdmin === true,
      viewer: incidentViewerFromContext(reader),
    }, ids, readable)
    : { rows: new Map(), deleted: new Map() };
  const ctx = { readable, references: resolution.rows, deleted: resolution.deleted };

  const named = (side: unknown): RelatedObjectSide => {
    if (side === null || side === undefined) return null;
    if (typeof side === 'string') return legacySide(side);
    const stored = asStored(side);
    if (!stored) return { hidden: true };
    return referenceValue(ctx, stored.kind, stored.id) ?? { hidden: true, kind: stored.kind };
  };
  return rows.map((row) => {
    const change = row.changed_fields?.related_to;
    if (!Array.isArray(change)) return row;
    return { ...row, changed_fields: { ...row.changed_fields, related_to: [named(change[0]), named(change[1])] } };
  });
}
