import type { EntityManager } from 'typeorm';
import { linkedParticipationScope, loadLinkedReads, type LinkedModule, type LinkedReads } from './linked-reads';
import type { ParticipationAccessScope } from '../../auth/business-contributor-scope';

/**
 * The linked records an activity names (a project's, a request's or a task's history, an incident's
 * journal), as one reader sees them. A change of links stores the names (or references) of the
 * records on each side. A reader who does not read every record of the family (no read of its
 * module, or a Business Contributor's participation) gets a side as a number: `{ labels: null,
 * hidden }` when no name shows, `{ labels, hidden }` when some do. The fact that a link changed
 * stays; the name or the reference of a record the person does not read never leaves the server.
 * The budget lines of a project's or a request's history follow the same shape
 * (`portfolio/budget-line-activity.ts`).
 */
export type LinkedActivitySide = string[] | { labels: string[] | null; hidden: number };

/** A side of a change counted: no name, the number of records. Anything else stays as stored. */
export function countedSide(side: unknown): unknown {
  return Array.isArray(side) ? { labels: null, hidden: side.length } : side;
}

/**
 * The entries of a side the reader may name (`shown`), and the number of the others: the list
 * itself when every entry shows, `{ labels, hidden }` otherwise.
 */
export function partlyCountedSide(side: string[], shown: (entry: string) => boolean): LinkedActivitySide {
  const labels = side.filter(shown);
  return labels.length === side.length ? side : { labels, hidden: side.length - labels.length };
}

type ActivityRow = { changed_fields?: Record<string, unknown> | null };

/**
 * Activities with each field of `counted` (true: the reader does not read every record it names)
 * turned into numbers on both sides (`[before, after]`). Rows without such a field are returned as
 * they are.
 */
export function withCountedLinkChanges<T extends ActivityRow>(rows: T[], counted: Record<string, boolean>): T[] {
  const fields = Object.keys(counted).filter((field) => counted[field]);
  if (fields.length === 0) return rows;
  return rows.map((row) => {
    const changed = row.changed_fields;
    if (!changed || !fields.some((field) => Array.isArray(changed[field]))) return row;
    const next: Record<string, unknown> = { ...changed };
    for (const field of fields) {
      const change = next[field];
      if (Array.isArray(change)) next[field] = change.map(countedSide);
    }
    return { ...row, changed_fields: next };
  });
}

/**
 * Whether a reader reads only part of a family's records, or none: no read of its module, or a
 * Business Contributor's participation scope on it. `scope` given: the scope already resolved by the
 * caller (`undefined` for everyone but a Business Contributor).
 */
export function readsPartOf(reads: LinkedReads | undefined, module: LinkedModule, scope?: ParticipationAccessScope): boolean {
  return !reads?.[module] || !!scope;
}

/**
 * The same, for a service reached without the request's permissions: the reads of the person from
 * their roles, and their participation scope on the module.
 */
export async function personReadsPartOf(
  manager: EntityManager,
  userId: string | null | undefined,
  tenantId: string | null | undefined,
  modules: LinkedModule[],
): Promise<Record<string, boolean>> {
  const reads = await loadLinkedReads(manager, userId, tenantId);
  const result: Record<string, boolean> = {};
  for (const module of modules) {
    result[module] = !reads[module] || !!(await linkedParticipationScope(manager, userId, tenantId, module));
  }
  return result;
}
