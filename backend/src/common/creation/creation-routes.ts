import { NotFoundException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { requestContextMissing } from '../../auth/module-right-required';
import { recordHistoryEntry } from '../../audit/record-history.inventory';
import { creationCancelExpired, issueCreationToken, verifyCreationToken } from './creation-token';
import { assertCreatorAloneSinceCreation, countChangesSinceCreation, type CreationChanges } from './creation-changes';

/**
 * The creation routes of a record its page creates at its title: the token handed with the created
 * record, what Cancel would delete (`GET :id/creation`), and Cancel itself (`DELETE :id/creation`).
 * Every family uses them. `table` is the record's table in the history inventory
 * (`record-history.inventory.ts`) and the token's family.
 *
 * `ctx` is the request's `TenantRequest`, or the same three values from a service.
 */

export type CreationContext = { tenantId: string; userId: string; manager?: EntityManager };

/** What a family adds to the history's count before Cancel: the children no audit row records. */
export type CreationChangesOptions = {
  /** Fields every save moves beside the field the save changed (a revision counter). */
  ignoreFields?: readonly string[];
  /** Completes the count (`withChildCount`) from a direct read, or refuses the cancel. */
  extra?: (changes: CreationChanges, manager: EntityManager) => Promise<CreationChanges>;
};

/** The context of a route that reads the raw request (`@Req()`). */
export function creationContextOf(req: any): CreationContext {
  return { tenantId: req?.tenant?.id ?? '', userId: req?.user?.sub ?? '', manager: req?.queryRunner?.manager };
}

function managerOf(ctx: CreationContext): EntityManager {
  if (!ctx.manager) throw requestContextMissing('Request context is missing');
  return ctx.manager;
}

/** 403 `CREATION_CANCEL_EXPIRED` unless `token` is this person's for this record. */
export function assertCreationToken(table: string, id: string, token: unknown, ctx: CreationContext): void {
  if (!verifyCreationToken(token, { tenantId: ctx.tenantId, family: table, recordId: String(id ?? ''), userId: ctx.userId })) {
    throw creationCancelExpired();
  }
}

/** The created record with the token that opens Cancel for this record and this person only. */
export function withCreationToken<T extends { id: string }>(table: string, created: T, ctx: CreationContext): T & { creation_token: string } {
  const creation_token = issueCreationToken({ tenantId: ctx.tenantId, family: table, recordId: created.id, userId: ctx.userId });
  return Object.assign(created, { creation_token });
}

/**
 * Before Cancel: what was written on the record and its children since its creation (its history's
 * audit rows, then `options.extra`). 404 when the record is not found, 403 `CREATION_CANCEL_EXPIRED`
 * once another person wrote on it. Nothing is written.
 */
export async function readCreationChanges(
  table: string,
  id: string,
  token: unknown,
  ctx: CreationContext,
  options: CreationChangesOptions = {},
): Promise<{ changes: CreationChanges }> {
  assertCreationToken(table, id, token, ctx);
  const manager = managerOf(ctx);
  const entry = recordHistoryEntry(table);
  if (!entry) throw new Error(`No record history entry for ${table}`);
  const found = await manager.query(`SELECT 1 FROM ${entry.table} WHERE id = $1 AND tenant_id = $2`, [id, ctx.tenantId]);
  if (!found.length) throw new NotFoundException('Record not found');
  await assertCreatorAloneSinceCreation(manager, ctx.tenantId, table, id, ctx.userId);
  const changes = await countChangesSinceCreation(manager, ctx.tenantId, table, id, { ignoreFields: options.ignoreFields });
  return { changes: options.extra ? await options.extra(changes, manager) : changes };
}

/**
 * Cancel: the creator deletes the record they just created, with its token, even without the
 * delete right, while nobody else has written on it (403 `CREATION_CANCEL_EXPIRED` otherwise,
 * checked under its lock). `remove` is the family's own delete (cascades, refusals, audit entry).
 */
export async function cancelCreation(
  table: string,
  id: string,
  token: unknown,
  ctx: CreationContext,
  remove: (manager: EntityManager) => Promise<unknown>,
): Promise<void> {
  assertCreationToken(table, id, token, ctx);
  const manager = managerOf(ctx);
  await assertCreatorAloneSinceCreation(manager, ctx.tenantId, table, id, ctx.userId, { lock: true });
  await remove(manager);
}
