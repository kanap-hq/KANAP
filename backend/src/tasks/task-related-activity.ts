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
 *
 * A phase is a value of a project (`phase_id`, stored by its name): it shows only to a person who
 * reads that project, as on the task's page (`withReadableTaskLinks`), and reads `{ hidden: true }`
 * otherwise. The project of a row is the one the task was on then: in a move, the side the value
 * belongs to (the phase left with the object left, the phase reached with the object reached);
 * before a move, its object left; after the last move, the task's object today. A side that is no
 * project, or not one the person reads (module, data access, participation), or an older row's text,
 * hides the phase.
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

/**
 * The activities (newest first, as `listForTask` reads them) with each side of a move named for
 * `reader`, and each phase hidden where the project it belongs to does not show; `current` is the
 * task's object today. The other rows and fields are unchanged.
 */
export async function withRelatedObjectsForReader<T extends ActivityRow>(
  rows: T[],
  reader: TaskActivityReader,
  current: { type: unknown; id: unknown } = { type: null, id: null },
): Promise<T[]> {
  const isMove = (row: T) => Array.isArray(row.changed_fields?.related_to);
  const hasPhase = (row: T) => Array.isArray(row.changed_fields?.phase_id);
  if (!rows.some((row) => isMove(row) || hasPhase(row))) return rows;

  const today = storedRelatedObject(current.type, current.id);
  const ids = new Map<FamilyKey, Set<string>>();
  const want = (stored: StoredRelatedObject | null) => {
    if (stored) ids.set(stored.kind, (ids.get(stored.kind) ?? new Set()).add(stored.id));
  };
  want(today);
  for (const row of rows) if (isMove(row)) for (const side of row.changed_fields!.related_to) want(asStored(side));
  const readable = readableFamilies({ isAdmin: reader.isAdmin === true, permissions: reader.permissions });
  // No person: nothing is named (every side by its kind, every phase hidden).
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
  /** Whether the phases of the task on this object show: a project the person reads. */
  const showsPhase = (side: unknown) => {
    const stored = asStored(side);
    if (!stored || stored.kind !== 'project') return false;
    const reference = referenceValue(ctx, 'project', stored.id);
    return !!reference && !('hidden' in reference);
  };
  const phaseValue = (value: unknown, shows: boolean) => (value === null || value === undefined || shows ? value ?? null : { hidden: true });

  // Newest first: the object of the task at a row is its object today, until a move goes back past it.
  let object: unknown = today;
  return rows.map((row) => {
    const changed = row.changed_fields;
    if (!changed || (!isMove(row) && !hasPhase(row))) return row;
    const next: Record<string, unknown> = { ...changed };
    if (isMove(row)) {
      const [before, after] = changed.related_to;
      next.related_to = [named(before), named(after)];
      if (hasPhase(row)) next.phase_id = [phaseValue(changed.phase_id[0], showsPhase(before)), phaseValue(changed.phase_id[1], showsPhase(after))];
      object = before;
    } else {
      const shows = showsPhase(object);
      next.phase_id = changed.phase_id.map((value) => phaseValue(value, shows));
    }
    return { ...row, changed_fields: next as T['changed_fields'] };
  });
}
