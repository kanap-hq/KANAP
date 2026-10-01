import { BadRequestException, NotFoundException } from '@nestjs/common';
import { EntityManager } from 'typeorm';

export type EntityType = 'task' | 'request' | 'project' | 'document' | 'spend' | 'capex' | 'incident' | 'contributor';

const EXPECTED_PREFIX: Record<EntityType, string> = {
  task: 'T',
  request: 'REQ',
  project: 'PRJ',
  document: 'DOC',
  spend: 'OPX',
  capex: 'CPX',
  incident: 'INC',
  contributor: 'CTR',
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ITEM_REF_RE = /^(T|PRJ|REQ|DOC|OPX|CPX|INC|CTR)-(\d+)$/i;

export function parseItemRef(
  raw: string,
  expectedType: EntityType,
): { type: 'uuid'; value: string } | { type: 'item_number'; value: number } {
  if (UUID_RE.test(raw)) return { type: 'uuid', value: raw };

  const m = raw.match(ITEM_REF_RE);
  if (m) {
    const prefix = m[1].toUpperCase();
    if (prefix !== EXPECTED_PREFIX[expectedType]) {
      throw new BadRequestException(
        `Invalid reference for ${expectedType}: expected ${EXPECTED_PREFIX[expectedType]}-N, got ${raw}`,
      );
    }
    return { type: 'item_number', value: parseInt(m[2], 10) };
  }

  // Also accept plain numbers
  if (/^\d+$/.test(raw)) {
    return { type: 'item_number', value: parseInt(raw, 10) };
  }

  throw new BadRequestException(`Invalid item reference: ${raw}`);
}

/**
 * Resolve an item reference (UUID, prefixed ref like T-1, or plain number) to a UUID.
 * Item numbers are per tenant: the lookup filters on the request's tenant
 * (`app_current_tenant()`, the session tenant the request transaction sets from
 * `req.tenant.id`), besides RLS. A UUID is returned as given; the caller's own
 * read resolves it under the tenant.
 */
export async function resolveToUuid(
  raw: string,
  entityType: EntityType,
  manager: EntityManager,
): Promise<string> {
  const parsed = parseItemRef(raw, entityType);
  if (parsed.type === 'uuid') return parsed.value;

  // Static query map — no dynamic table interpolation
  const queries: Record<EntityType, string> = {
    task: 'SELECT id FROM tasks WHERE tenant_id = app_current_tenant() AND item_number = $1 LIMIT 1',
    request: 'SELECT id FROM portfolio_requests WHERE tenant_id = app_current_tenant() AND item_number = $1 LIMIT 1',
    project: 'SELECT id FROM portfolio_projects WHERE tenant_id = app_current_tenant() AND item_number = $1 LIMIT 1',
    document: 'SELECT id FROM documents WHERE tenant_id = app_current_tenant() AND item_number = $1 LIMIT 1',
    spend: 'SELECT id FROM spend_items WHERE tenant_id = app_current_tenant() AND item_number = $1 LIMIT 1',
    capex: 'SELECT id FROM capex_items WHERE tenant_id = app_current_tenant() AND item_number = $1 LIMIT 1',
    incident: 'SELECT id FROM incidents WHERE tenant_id = app_current_tenant() AND item_number = $1 LIMIT 1',
    contributor: 'SELECT id FROM portfolio_team_member_configs WHERE tenant_id = app_current_tenant() AND item_number = $1 LIMIT 1',
  };

  const rows = await manager.query(queries[entityType], [parsed.value]);
  if (rows.length === 0) {
    // Incidents answer "Incident not found" whether the record is missing or
    // hidden (confidential), so the message never reveals which one it is.
    throw new NotFoundException(entityType === 'incident' ? 'Incident not found' : 'Item not found');
  }
  return rows[0].id;
}
