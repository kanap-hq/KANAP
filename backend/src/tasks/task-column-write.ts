import { NotFoundException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { Task } from './task.entity';
import { assertTaskWritten } from './task-data-access';

/** Columns a task write never sets: its identity, its tenant, its number, its creation time. */
const FIXED_COLUMNS: ReadonlySet<string> = new Set(['id', 'tenant_id', 'item_number', 'created_at']);

/**
 * Writes the given columns of one task, and those only, then reads the task again. Never the whole
 * entity read before: TypeORM's `save()` reads the row again and writes back every column that
 * differs from the entity, so a column another request changed since the first read would go back
 * to the value read first. The task's relation above all: a change of type of its budget line moves
 * the line's tasks to the other type (`spend_item` / `capex_item`, lot M), under the line's lock,
 * which a task write does not take; a task written back with the type of before would be shown by
 * no reader. A key that is not a column of the task, or is undefined, is left out.
 */
export async function writeTaskColumns(
  repo: Repository<Task>,
  task: { id: string; tenant_id: string },
  changes: Record<string, unknown>,
): Promise<Task> {
  const columns = new Set(repo.metadata.columns.map((column) => column.propertyName));
  const set: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(changes)) {
    if (value === undefined || FIXED_COLUMNS.has(key) || !columns.has(key)) continue;
    set[key] = value;
  }
  if (Object.keys(set).length > 0) {
    const result = await repo.update({ id: task.id, tenant_id: task.tenant_id } as any, set as any);
    // A limited person's write the policies hid (task read through its object or as an observer).
    await assertTaskWritten(repo.manager, result.affected);
  }
  const saved = await repo.findOne({ where: { id: task.id, tenant_id: task.tenant_id } as any });
  if (!saved) throw new NotFoundException('Task not found');
  return saved;
}
