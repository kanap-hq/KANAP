import { NotFoundException } from '@nestjs/common';
import type { TenantRequest } from '../decorators/tenant.decorator';
import { requestContextMissing } from '../../auth/module-right-required';
import { recordHistoryEntry } from '../../audit/record-history.inventory';
import { creationCancelExpired, issueCreationToken, verifyCreationToken } from './creation-token';
import { assertCreatorAloneSinceCreation, countChangesSinceCreation, type CreationChanges } from './creation-changes';

/**
 * The creation routes of a record its page creates once its title and required fields are given
 * (reference data and contracts, lot V2), the way applications write them inline: the token handed
 * with the created record, what Cancel would delete (`GET :id/creation`), and Cancel itself
 * (`DELETE :id/creation`). `table` is the record's table in the history inventory
 * (`record-history.inventory.ts`) and the token's family.
 */

function managerOf(ctx: TenantRequest) {
  if (!ctx.manager) throw requestContextMissing('Request context is missing');
  return ctx.manager;
}

function assertCreationToken(table: string, id: string, token: unknown, ctx: TenantRequest): void {
  if (!verifyCreationToken(token, { tenantId: ctx.tenantId, family: table, recordId: String(id ?? ''), userId: ctx.userId })) {
    throw creationCancelExpired();
  }
}

/** The created record with the token that opens Cancel for this record and this person only. */
export function withCreationToken<T extends { id: string }>(table: string, created: T, ctx: TenantRequest): T & { creation_token: string } {
  const creation_token = issueCreationToken({ tenantId: ctx.tenantId, family: table, recordId: created.id, userId: ctx.userId });
  return Object.assign(created, { creation_token });
}

/** Before Cancel: what was written on the record and its children since its creation. Nothing is written. */
export async function readCreationChanges(
  table: string,
  id: string,
  token: unknown,
  ctx: TenantRequest,
): Promise<{ changes: CreationChanges }> {
  assertCreationToken(table, id, token, ctx);
  const manager = managerOf(ctx);
  const entry = recordHistoryEntry(table);
  if (!entry) throw new Error(`No record history entry for ${table}`);
  const found = await manager.query(`SELECT 1 FROM ${entry.table} WHERE id = $1 AND tenant_id = $2`, [id, ctx.tenantId]);
  if (!found.length) throw new NotFoundException('Record not found');
  await assertCreatorAloneSinceCreation(manager, ctx.tenantId, table, id, ctx.userId);
  return { changes: await countChangesSinceCreation(manager, ctx.tenantId, table, id) };
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
  ctx: TenantRequest,
  remove: () => Promise<unknown>,
): Promise<void> {
  assertCreationToken(table, id, token, ctx);
  await assertCreatorAloneSinceCreation(managerOf(ctx), ctx.tenantId, table, id, ctx.userId, { lock: true });
  await remove();
}
