import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import type { AuditService } from '../audit/audit.service';
import { parseTargetId } from '../common/relations/relation-target';

/**
 * The Relations tab of an interface (lot R2f): its upstream and downstream interfaces in one round
 * trip, and one link at a time. Web links and attachments stay on their own routes.
 *
 * A dependency is one row of `interface_dependencies` on the interface that holds it
 * (`interface_id`, `related_interface_id`, `direction`). An upstream B of A is not written as a
 * downstream A of B: each interface keeps its own list, as the bulk replacement does. The audit is
 * the bulk replacement's: `interface_dependencies`, `recordId` the interface, `before` and `after`
 * the sorted `direction:id` of all its dependencies, written only when they change.
 * The bulk replacement deletes and inserts every row; one link here inserts or deletes one row
 * under the interface lock (`FOR NO KEY UPDATE`).
 */

export const INTERFACE_RELATION_KINDS = ['upstream', 'downstream'] as const;
export type InterfaceRelationKind = (typeof INTERFACE_RELATION_KINDS)[number];

/** A linked interface: its `INT-n` reference, its name, its two applications and its lifecycle. */
export type RelatedInterface = {
  id: string;
  reference: string | null;
  name: string;
  source_application_name: string | null;
  target_application_name: string | null;
  lifecycle: string;
};

export type InterfaceRelations = {
  upstream: RelatedInterface[];
  downstream: RelatedInterface[];
};

export type InterfaceRelationsDeps = {
  manager: EntityManager;
  audit: Pick<AuditService, 'log'>;
  /** The interface id from a uuid, an `INT-n` reference or a legacy code; 404 when missing. */
  resolve: (ref: string) => Promise<string>;
};

const INTERFACE_NOT_FOUND = 'Interface not found';
const TARGET_NOT_FOUND = 'One or more interfaces were not found.';
const SELF_DEPENDENCY = 'An interface cannot depend on itself.';

export function interfaceRelationKindOrThrow(value: string): InterfaceRelationKind {
  if (!(INTERFACE_RELATION_KINDS as readonly string[]).includes(value)) {
    throw new NotFoundException('Unknown relation type.');
  }
  return value as InterfaceRelationKind;
}

async function loadInterface(deps: InterfaceRelationsDeps, ref: string): Promise<{ id: string; tenant_id: string }> {
  const id = await deps.resolve(ref);
  const [row]: Array<{ id: string; tenant_id: string }> = await deps.manager.query(
    `SELECT id, tenant_id FROM interfaces WHERE tenant_id = app_current_tenant() AND id = $1`,
    [id],
  );
  if (!row) throw new NotFoundException(INTERFACE_NOT_FOUND);
  return row;
}

async function listDirection(
  mg: EntityManager,
  tenantId: string,
  interfaceId: string,
  direction: InterfaceRelationKind,
): Promise<RelatedInterface[]> {
  return mg.query(
    `SELECT i.id, i.interface_reference AS reference, i.name, i.lifecycle,
            sa.name AS source_application_name, ta.name AS target_application_name
       FROM interfaces i
       LEFT JOIN applications sa ON sa.tenant_id = i.tenant_id AND sa.id = i.source_application_id
       LEFT JOIN applications ta ON ta.tenant_id = i.tenant_id AND ta.id = i.target_application_id
      WHERE i.tenant_id = $1
        AND EXISTS (
          SELECT 1 FROM interface_dependencies d
           WHERE d.tenant_id = i.tenant_id AND d.interface_id = $2
             AND d.related_interface_id = i.id AND d.direction = $3
        )
      ORDER BY lower(i.name), i.id`,
    [tenantId, interfaceId, direction],
  );
}

/** The tab in one round trip. The interface must exist in the tenant (404 otherwise). */
export async function readInterfaceRelations(deps: InterfaceRelationsDeps, ref: string): Promise<InterfaceRelations> {
  const owner = await loadInterface(deps, ref);
  // One query after the other: the request's connection runs them in turn.
  const upstream = await listDirection(deps.manager, owner.tenant_id, owner.id, 'upstream');
  const downstream = await listDirection(deps.manager, owner.tenant_id, owner.id, 'downstream');
  return { upstream, downstream };
}

/**
 * Link or unlink one upstream or downstream interface. A bad id is 400 before a missing interface
 * is 404. An interface cannot depend on itself (400), and the target must exist in the tenant (400).
 * Linking what is linked, or unlinking what is not, changes nothing and writes no audit row.
 */
export async function setInterfaceRelation(
  deps: InterfaceRelationsDeps,
  kindValue: string,
  ref: string,
  targetId: string,
  add: boolean,
  userId: string | null,
): Promise<{ ok: true; changed: boolean }> {
  const direction = interfaceRelationKindOrThrow(kindValue);
  const relatedId = parseTargetId(targetId);
  const owner = await loadInterface(deps, ref);
  const mg = deps.manager;
  const locked: unknown[] = await mg.query(
    `SELECT 1 FROM interfaces WHERE tenant_id = $1 AND id = $2 FOR NO KEY UPDATE`,
    [owner.tenant_id, owner.id],
  );
  if (locked.length === 0) throw new NotFoundException(INTERFACE_NOT_FOUND);
  if (String(owner.id).toLowerCase() === relatedId) throw new BadRequestException(SELF_DEPENDENCY);
  if (add) {
    const exists: unknown[] = await mg.query(
      `SELECT 1 FROM interfaces WHERE tenant_id = $1 AND id = $2`,
      [owner.tenant_id, relatedId],
    );
    if (exists.length === 0) throw new BadRequestException(TARGET_NOT_FOUND);
  }

  const current: Array<{ direction: string; id: string }> = await mg.query(
    `SELECT direction, related_interface_id AS id FROM interface_dependencies WHERE tenant_id = $1 AND interface_id = $2`,
    [owner.tenant_id, owner.id],
  );
  const before = current.map((row) => `${row.direction}:${String(row.id).toLowerCase()}`).sort();
  const entry = `${direction}:${relatedId}`;
  if (before.includes(entry) === add) return { ok: true, changed: false };

  const [{ n }]: Array<{ n: number }> = await mg.query(
    add
      ? `WITH c AS (
           INSERT INTO interface_dependencies (tenant_id, interface_id, related_interface_id, direction)
           VALUES ($1, $2, $3, $4) RETURNING 1
         ) SELECT count(*)::int AS n FROM c`
      : `WITH c AS (
           DELETE FROM interface_dependencies
            WHERE tenant_id = $1 AND interface_id = $2 AND related_interface_id = $3 AND direction = $4
           RETURNING 1
         ) SELECT count(*)::int AS n FROM c`,
    [owner.tenant_id, owner.id, relatedId, direction],
  );
  if (Number(n) === 0) return { ok: true, changed: false };
  const after = (add ? [...before, entry] : before.filter((value) => value !== entry)).sort();
  await deps.audit.log(
    { table: 'interface_dependencies', recordId: owner.id, action: 'update', before, after, userId },
    { manager: mg },
  );
  return { ok: true, changed: true };
}
