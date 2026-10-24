import type { EntityManager } from 'typeorm';

/**
 * Whether other persons could read an object (planning/data-scoped-access/spec.md §5.6, §6.6):
 * `data_access_can_read(person, type, id)` for several persons in one statement. Used by the
 * notifications (a recipient who is not named on the object) and by "Send the link" (the warning).
 */

/** The objects `data_access_can_read` answers for: a budget line (either nature), a task, a contract. */
export type CanReadObjectType = 'spend_item' | 'task' | 'contract';

/** The task objects the access scopes (spec §4.4): a line of either nature, or a contract. */
export const SCOPED_TASK_OBJECT_TYPES: readonly string[] = ['spend_item', 'capex_item', 'contract'];

/**
 * Of `userIds`, the persons for whom the function answers `answer` (true: they can read the object;
 * false: they cannot), lower-case. NULL (the object outside the caller's access, the limited role
 * without context) matches neither, so a caller never learns about an object it cannot see.
 */
export async function personsByReadAccess(
  manager: Pick<EntityManager, 'query'>,
  type: CanReadObjectType,
  id: string,
  userIds: readonly string[],
  answer: boolean,
): Promise<Set<string>> {
  const ids = Array.from(new Set(userIds.filter(Boolean).map((u) => u.toLowerCase())));
  if (ids.length === 0) return new Set();
  const rows: Array<{ id: string }> = await manager.query(
    `SELECT p.id::text AS id
       FROM unnest($1::uuid[]) AS p(id)
      WHERE data_access_can_read(p.id, $2, $3) IS ${answer ? 'TRUE' : 'FALSE'}`,
    [ids, type, id],
  );
  return new Set(rows.map((row) => row.id));
}

/** A person chosen in "Send the link", as the share routes read them. */
export type ShareRecipientRow = { userId: string; email: string; firstName?: string | null; lastName?: string | null };

/**
 * "Send the link" (spec §5.6): of the persons chosen, those who cannot open the object, by name
 * (names only; the email for a person without a name), so the screen warns the sender. The link is
 * sent to them anyway. Budget lines, tasks and contracts only: the other objects are not scoped.
 * Read in the sender's transaction, one statement for all the persons.
 */
export async function shareRecipientsWhoCannotOpen(
  manager: Pick<EntityManager, 'query'>,
  type: CanReadObjectType,
  id: string,
  recipients: readonly ShareRecipientRow[],
): Promise<Array<{ id: string; name: string }>> {
  const cannot = await personsByReadAccess(manager, type, id, recipients.map((r) => r.userId), false);
  return recipients
    .filter((r) => cannot.has(String(r.userId).toLowerCase()))
    .map((r) => ({ id: r.userId, name: `${r.firstName ?? ''} ${r.lastName ?? ''}`.trim() || r.email }));
}
