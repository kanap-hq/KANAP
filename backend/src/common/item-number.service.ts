import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';

export type SequenceEntityType = 'task' | 'request' | 'project' | 'document' | 'application' | 'spend' | 'capex' | 'incident' | 'contributor' | 'technology';

/**
 * Atomically allocate the next item number for a given entity type and tenant.
 *
 * Uses INSERT ... ON CONFLICT ... DO UPDATE ... RETURNING to guarantee uniqueness
 * even under concurrent inserts. Runs inside the caller's transaction.
 */
async function allocateSingle(
  entityType: SequenceEntityType,
  tenantId: string,
  manager: EntityManager,
): Promise<number> {
  const rows: { item_number: number }[] = await manager.query(
    `INSERT INTO item_sequences (tenant_id, entity_type, next_val)
     VALUES ($1, $2, 2)
     ON CONFLICT (tenant_id, entity_type)
     DO UPDATE SET next_val = item_sequences.next_val + 1
     RETURNING next_val - 1 AS item_number`,
    [tenantId, entityType],
  );
  return rows[0].item_number;
}

/**
 * Atomically allocate a contiguous block of item numbers.
 * Returns the FIRST number in the allocated range.
 * The caller gets numbers: first, first+1, ..., first+count-1.
 */
export async function allocateItemNumbers(
  entityType: SequenceEntityType,
  tenantId: string,
  count: number,
  manager: EntityManager,
): Promise<number> {
  if (count <= 0) throw new Error('count must be > 0');
  if (count === 1) return allocateSingle(entityType, tenantId, manager);

  const rows: { first_number: number }[] = await manager.query(
    `INSERT INTO item_sequences (tenant_id, entity_type, next_val)
     VALUES ($1, $2, $3 + 1)
     ON CONFLICT (tenant_id, entity_type)
     DO UPDATE SET next_val = item_sequences.next_val + $3
     RETURNING next_val - $3 AS first_number`,
    [tenantId, entityType, count],
  );
  return rows[0].first_number;
}

@Injectable()
export class ItemNumberService {
  async nextItemNumber(
    entityType: SequenceEntityType,
    tenantId: string,
    manager: EntityManager,
  ): Promise<number> {
    return allocateSingle(entityType, tenantId, manager);
  }

  async nextItemNumbers(
    entityType: SequenceEntityType,
    tenantId: string,
    count: number,
    manager: EntityManager,
  ): Promise<number> {
    return allocateItemNumbers(entityType, tenantId, count, manager);
  }
}
