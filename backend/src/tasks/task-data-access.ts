import { EntityManager } from 'typeorm';
import { DataAccessLimitedException, isLimitedTransaction, lineEditableSql } from '../data-access/line-write-checks';

/**
 * Data-scoped access, lot 3: the writes of a task whose object is a budget line or a contract
 * (planning/data-scoped-access/spec.md §4.4, §6.8). Other tasks are not scoped and pass.
 *
 * - A task the person may not modify (object not modifiable, and neither assignee nor owner) is
 *   refused with a clear 403 before the UPDATE, which would touch no row.
 * - Handover: a responsible person may hand the task to someone else. When the person cannot read
 *   the task's object and would no longer be a participant, PostgreSQL would refuse the new row
 *   (an UPDATE keeps the row visible to whoever makes it, spec §6.8): the service adds the person to
 *   the observers in the same update, and the answer says `stillFollowing: true`.
 *
 * The rules stay in the database: `data_access_task_modifiable` for the task, the line's SELECT
 * policy or `data_access_contract_visible` for the object. An unscoped person costs no query.
 */

export const DATA_ACCESS_READ_ONLY_TASK_MESSAGE = 'This task is read only in your access.';
/** The delete of a task needs its object modifiable; being responsible for the task is not enough (spec §4.4). */
export const DATA_ACCESS_TASK_DELETE_MESSAGE = 'Only someone who can modify the line or contract of this task can delete it.';

const SCOPED_TYPES = new Set(['spend_item', 'capex_item', 'contract']);

type TaskParticipants = {
  id: string;
  related_object_type: string | null;
  related_object_id: string | null;
  assignee_user_id: string | null;
  owner_ids: string[] | null;
  viewer_ids: string[] | null;
};

/**
 * Checks a task write and returns the columns to write (with the person added to the observers on
 * a handover) and whether that happened. `changes` are the columns the write sets.
 */
export async function prepareTaskWrite(
  manager: EntityManager,
  task: TaskParticipants,
  changes: Record<string, unknown>,
): Promise<{ changes: Record<string, unknown>; stillFollowing: boolean }> {
  if (!SCOPED_TYPES.has(task.related_object_type ?? '') || !(await isLimitedTransaction(manager))) {
    return { changes, stillFollowing: false };
  }
  const next = <K extends keyof TaskParticipants>(key: K): TaskParticipants[K] =>
    (Object.prototype.hasOwnProperty.call(changes, key) && changes[key] !== undefined ? changes[key] : task[key]) as TaskParticipants[K];
  const objectType = next('related_object_type');
  const objectId = next('related_object_id');
  const [row] = await manager.query(
    `SELECT data_access_task_modifiable($1::uuid) AS modifiable,
            NULLIF(current_setting('app.da_user', true), '') AS person,
            CASE
              WHEN $2::text IN ('spend_item', 'capex_item') THEN EXISTS (SELECT 1 FROM spend_items i WHERE i.id = $3::uuid)
              WHEN $2::text = 'contract' THEN data_access_contract_visible($3::uuid)
              ELSE true
            END AS object_readable`,
    [task.id, objectType, objectId],
  );
  if (row?.modifiable !== true) throw new DataAccessLimitedException(DATA_ACCESS_READ_ONLY_TASK_MESSAGE);
  const person: string | null = row?.person ?? null;
  if (row?.object_readable === true || !person) return { changes, stillFollowing: false };

  const owners = next('owner_ids') ?? [];
  const viewers = next('viewer_ids') ?? [];
  const participant = next('assignee_user_id') === person || owners.includes(person) || viewers.includes(person);
  if (participant) return { changes, stillFollowing: false };
  return { changes: { ...changes, viewer_ids: [...viewers, person] }, stillFollowing: true };
}

/** A refused task write that touched no row (`writeTaskColumns`): the clear 403, never a silent success. */
export async function assertTaskWritten(manager: EntityManager, affected: number | null | undefined): Promise<void> {
  // A driver that reports no count (never PostgreSQL) leaves nothing to check.
  if (affected == null || affected > 0) return;
  if (await isLimitedTransaction(manager)) throw new DataAccessLimitedException(DATA_ACCESS_READ_ONLY_TASK_MESSAGE);
}

/**
 * A write on an element of a task (time entry, attachment, linked application or asset): the task
 * must be modifiable (`data_access_task_modifiable`, the policy of the task elements). Refused with
 * the clear 403 before anything is written or stored; the database would refuse the INSERT (42501)
 * and let the UPDATE or DELETE touch no row. An unscoped person costs no query.
 */
export async function assertTaskModifiable(manager: EntityManager, taskId: string | null | undefined): Promise<void> {
  if (!taskId || !(await isLimitedTransaction(manager))) return;
  const [row] = await manager.query(`SELECT data_access_task_modifiable($1::uuid) AS modifiable`, [taskId]);
  if (row?.modifiable !== true) throw new DataAccessLimitedException(DATA_ACCESS_READ_ONLY_TASK_MESSAGE);
}

/**
 * The delete of a task of a line or a contract: the DELETE policy of `tasks` asks for the object
 * modifiable (the line by `data_access_line_editable`, the contract by
 * `data_access_contract_modifiable`); a responsible person who cannot modify the object would see a
 * delete that touches no row. Refused with the clear 403 before anything is deleted.
 */
export async function assertTaskDeletable(
  manager: EntityManager,
  task: Pick<TaskParticipants, 'related_object_type' | 'related_object_id'>,
): Promise<void> {
  if (!SCOPED_TYPES.has(task.related_object_type ?? '') || !(await isLimitedTransaction(manager))) return;
  const [row] = await manager.query(
    `SELECT CASE WHEN $1::text = 'contract' THEN data_access_contract_modifiable($2::uuid)
                 ELSE EXISTS (SELECT 1 FROM spend_items i WHERE i.id = $2::uuid AND ${lineEditableSql('i.')})
            END AS deletable`,
    [task.related_object_type, task.related_object_id],
  );
  if (row?.deletable !== true) throw new DataAccessLimitedException(DATA_ACCESS_TASK_DELETE_MESSAGE);
}
