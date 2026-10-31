import { NotFoundException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { parseItemNumber } from '../common/parse-item-number';

/** Any uuid shape (not only v1-v5). */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The business reference of each AI entity family that has one, and the tenant-scoped lookup that
 * finds its row. Static SQL only. Families missing here (contracts, companies, ...) have no reference.
 * Budget lines (BL/OPX/CPX) and documents (DOC) are resolved by their own services.
 */
const REFERENCE_LOOKUPS: Record<string, { pattern: RegExp; sql: string; value: (n: string) => string | number }> = {
  applications: {
    pattern: /^APP-(\d+)$/i,
    sql: 'SELECT id FROM applications WHERE tenant_id = $1 AND upper(sequential_id) = $2 LIMIT 1',
    value: (n) => `APP-${Number(n)}`,
  },
  assets: {
    pattern: /^AST-(\d+)$/i,
    sql: 'SELECT id FROM assets WHERE tenant_id = $1 AND upper(asset_reference) = $2 LIMIT 1',
    value: (n) => `AST-${Number(n)}`,
  },
  projects: {
    pattern: /^PRJ-?(\d+)$/i,
    sql: 'SELECT id FROM portfolio_projects WHERE tenant_id = $1 AND item_number = $2 LIMIT 1',
    value: Number,
  },
  requests: {
    pattern: /^REQ-?(\d+)$/i,
    sql: 'SELECT id FROM portfolio_requests WHERE tenant_id = $1 AND item_number = $2 LIMIT 1',
    value: Number,
  },
  tasks: {
    pattern: /^T-?(\d+)$/i,
    sql: 'SELECT id FROM tasks WHERE tenant_id = $1 AND item_number = $2 LIMIT 1',
    value: Number,
  },
  incidents: {
    pattern: /^INC-?(\d+)$/i,
    sql: 'SELECT id FROM incidents WHERE tenant_id = $1 AND item_number = $2 LIMIT 1',
    value: Number,
  },
  technologies: {
    pattern: /^TEC-?(\d+)$/i,
    sql: 'SELECT id FROM technologies WHERE tenant_id = $1 AND item_number = $2 LIMIT 1',
    value: Number,
  },
};

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

export function entityNotFound(entityType: string, value: string): NotFoundException {
  return new NotFoundException(`No ${entityType} record matches "${value}". Search for it first, then use its id or reference.`);
}

/**
 * Resolve an AI tool's `entity_id` to the row's uuid when it is a uuid or the family's business
 * reference (APP-1, AST-3, PRJ-12, REQ-7, T-42, INC-2, TEC-5), in the caller's tenant. Returns null when
 * the value is neither, so the caller decides how to search; a well-formed reference that matches
 * no row throws the same "not found" as an unknown name. Access checks stay with the service that
 * loads the row.
 */
export async function resolveAiEntityReference(
  manager: Pick<EntityManager, 'query'>,
  tenantId: string,
  entityType: string,
  rawId: string,
): Promise<string | null> {
  const value = String(rawId || '').trim();
  if (isUuid(value)) return value;
  const lookup = REFERENCE_LOOKUPS[entityType];
  const number = lookup ? value.match(lookup.pattern)?.[1] : undefined;
  if (!lookup || number == null || parseItemNumber(number) == null) return null;
  const rows: Array<{ id: string }> = await manager.query(lookup.sql, [tenantId, lookup.value(number)]);
  if (rows.length === 0) throw entityNotFound(entityType, value);
  return String(rows[0].id);
}
