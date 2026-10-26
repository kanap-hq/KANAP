import { NotFoundException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';

/**
 * Any uuid in its text form (every version, v7 included), never a reference, so a cast cannot
 * fail. The shape the rest of the code accepts.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * `AST-77`, or `AST-77-anything` the way `APP-n` keeps a suffix.
 * The stored reference is the first group.
 */
const REFERENCE_RE = /^(AST-\d+)(?:-.+)?$/i;

/**
 * The asset id behind a uuid or an `AST-n` reference (a suffix after the reference is ignored).
 * Anything else, and a reference this tenant does not have, is a 404. The lookup is raw SQL:
 * a non-uuid never reaches a uuid column.
 */
export async function resolveAssetId(manager: EntityManager, identifier: string, tenantId?: string): Promise<string> {
  const normalized = String(identifier || '').trim();
  const uuid = UUID_RE.test(normalized);
  const reference = normalized.match(REFERENCE_RE);
  if (!uuid && !reference) throw new NotFoundException('Asset not found');

  const rows: Array<{ id: string }> = await manager.query(
    uuid
      ? `SELECT id::text AS id
         FROM assets
         WHERE id = $1
           AND tenant_id = COALESCE($2::uuid, app_current_tenant())
         LIMIT 1`
      : `SELECT id::text AS id
         FROM assets
         WHERE upper(asset_reference) = $1
           AND tenant_id = COALESCE($2::uuid, app_current_tenant())
         LIMIT 1`,
    [uuid ? normalized : reference![1].toUpperCase(), tenantId || null],
  );
  const id = rows[0]?.id;
  if (!id) throw new NotFoundException('Asset not found');
  return id;
}
