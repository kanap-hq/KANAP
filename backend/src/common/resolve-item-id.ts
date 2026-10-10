import { BadRequestException, NotFoundException } from '@nestjs/common';
import { EntityManager } from 'typeorm';

export type EntityType = 'task' | 'request' | 'project' | 'document' | 'spend' | 'capex' | 'incident' | 'contributor';

/** The prefix a reference of each type carries, the one the "expected" message names. */
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

/**
 * Other prefixes a type accepts: a budget line also answers to its neutral reference `BL-n` (plan
 * planning/budget-unifie.md, decision U3), on the routes of its own nature only.
 */
const ALSO_ACCEPTED_PREFIXES: Partial<Record<EntityType, readonly string[]>> = {
  spend: ['BL'],
  capex: ['BL'],
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ITEM_REF_RE = /^(T|PRJ|REQ|DOC|OPX|CPX|INC|CTR)-(\d+)$/i;
/** A reference with a prefix only some types accept (`BL-n`): another type reads it as malformed. */
const OTHER_REF_RE = /^([A-Z]+)-(\d+)$/i;

export type ParsedItemRef =
  | { type: 'uuid'; value: string }
  /** `prefix`: the reference's prefix in capitals; absent for a plain number. */
  | { type: 'item_number'; value: number; prefix?: string };

export function parseItemRef(raw: string, expectedType: EntityType): ParsedItemRef {
  if (UUID_RE.test(raw)) return { type: 'uuid', value: raw };

  const m = raw.match(ITEM_REF_RE);
  if (m) {
    const prefix = m[1].toUpperCase();
    if (prefix !== EXPECTED_PREFIX[expectedType] && !ALSO_ACCEPTED_PREFIXES[expectedType]?.includes(prefix)) {
      throw new BadRequestException(
        `Invalid reference for ${expectedType}: expected ${EXPECTED_PREFIX[expectedType]}-N, got ${raw}`,
      );
    }
    return { type: 'item_number', value: parseInt(m[2], 10), prefix };
  }
  const other = raw.match(OTHER_REF_RE);
  if (other && ALSO_ACCEPTED_PREFIXES[expectedType]?.includes(other[1].toUpperCase())) {
    return { type: 'item_number', value: parseInt(other[2], 10), prefix: other[1].toUpperCase() };
  }

  // Also accept plain numbers
  if (/^\d+$/.test(raw)) {
    return { type: 'item_number', value: parseInt(raw, 10) };
  }

  throw new BadRequestException(`Invalid item reference: ${raw}`);
}

/**
 * An OPEX line by its number (OPX-n, BL-n or a plain number), else, for `OPX-n`, by the legacy
 * number it kept (`spend_items.legacy_number`, migration 1853950000000): a line of the tenant of
 * nature `opex` only (`spend/budget-nature.ts`); a line of another nature is not found.
 */
const SPEND_BY_NUMBER = `SELECT id FROM spend_items
  WHERE tenant_id = app_current_tenant() AND nature = 'opex' AND (item_number = $1 OR legacy_number = $2)
  ORDER BY (item_number = $1) DESC
  LIMIT 1`;

/**
 * A CAPEX line (lot Z1: in `spend_items`, nature `capex`) by the number the CAPEX routes have
 * always shown: its CPX number (`CPX-n` or a plain number, kept in `legacy_number`), or by its own
 * number for `BL-n` ($2 NULL); a line of another nature is not found.
 */
const CAPEX_BY_NUMBER = `SELECT id FROM spend_items
  WHERE tenant_id = app_current_tenant() AND nature = 'capex'
    AND (CASE WHEN $2::text IS NULL THEN item_number = $1 ELSE legacy_number = $2::text END)
  LIMIT 1`;

/** The nature of the lines a type of reference resolves to; the UUID of a line of the other nature is refused. */
const LINE_NATURE: Partial<Record<EntityType, 'opex' | 'capex'>> = { spend: 'opex', capex: 'capex' };

/**
 * Resolve an item reference (UUID, prefixed ref like T-1, or plain number) to a UUID.
 * Item numbers are per tenant: the lookup filters on the request's tenant
 * (`app_current_tenant()`, the session tenant the request transaction sets from
 * `req.tenant.id`), besides RLS. A UUID is returned as given; the caller's own
 * read resolves it under the tenant. A budget line of another nature than the
 * type's is the one exception: `spend` resolves OPEX lines only and `capex`
 * CAPEX lines only, so the UUID of a line of the other nature is refused here
 * (404) on every route of each (plan planning/budget-unifie.md, G.7).
 */
export async function resolveToUuid(
  raw: string,
  entityType: EntityType,
  manager: EntityManager,
): Promise<string> {
  const parsed = parseItemRef(raw, entityType);
  if (parsed.type === 'uuid') {
    const nature = LINE_NATURE[entityType];
    if (nature) {
      const other = await manager.query(
        `SELECT 1 FROM spend_items WHERE tenant_id = app_current_tenant() AND id = $1 AND nature <> $2 LIMIT 1`,
        [parsed.value, nature],
      );
      if (other.length > 0) throw new NotFoundException('Item not found');
    }
    return parsed.value;
  }

  // Static query map — no dynamic table interpolation
  const queries: Record<EntityType, string> = {
    task: 'SELECT id FROM tasks WHERE tenant_id = app_current_tenant() AND item_number = $1 LIMIT 1',
    request: 'SELECT id FROM portfolio_requests WHERE tenant_id = app_current_tenant() AND item_number = $1 LIMIT 1',
    project: 'SELECT id FROM portfolio_projects WHERE tenant_id = app_current_tenant() AND item_number = $1 LIMIT 1',
    document: 'SELECT id FROM documents WHERE tenant_id = app_current_tenant() AND item_number = $1 LIMIT 1',
    spend: SPEND_BY_NUMBER,
    capex: CAPEX_BY_NUMBER,
    incident: 'SELECT id FROM incidents WHERE tenant_id = app_current_tenant() AND item_number = $1 LIMIT 1',
    contributor: 'SELECT id FROM portfolio_team_member_configs WHERE tenant_id = app_current_tenant() AND item_number = $1 LIMIT 1',
  };

  // `spend`: the legacy number is tried for an OPX reference only (BL-n and plain numbers are item numbers).
  // `capex`: CPX-n and a plain number are the CPX number (legacy), BL-n the line's own number.
  const params = entityType === 'spend'
    ? [parsed.value, parsed.prefix === EXPECTED_PREFIX.spend ? `${EXPECTED_PREFIX.spend}-${parsed.value}` : null]
    : entityType === 'capex'
      ? [parsed.value, parsed.prefix === 'BL' ? null : `${EXPECTED_PREFIX.capex}-${parsed.value}`]
      : [parsed.value];
  const rows = await manager.query(queries[entityType], params);
  if (rows.length === 0) {
    // Incidents answer "Incident not found" whether the record is missing or
    // hidden (confidential), so the message never reveals which one it is.
    throw new NotFoundException(entityType === 'incident' ? 'Incident not found' : 'Item not found');
  }
  return rows[0].id;
}
