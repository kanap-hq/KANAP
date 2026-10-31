import { BadRequestException, NotFoundException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { parseItemNumber } from './parse-item-number';

export type EntityType = 'task' | 'request' | 'project' | 'document' | 'spend' | 'capex' | 'incident' | 'contributor' | 'technology';

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
  technology: 'TEC',
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
const ITEM_REF_RE = /^(T|PRJ|REQ|DOC|OPX|CPX|INC|CTR|TEC)-(\d+)$/i;
/** A reference with a prefix only some types accept (`BL-n`): another type reads it as malformed. */
const OTHER_REF_RE = /^([A-Z]+)-(\d+)$/i;

export type ParsedItemRef =
  | { type: 'uuid'; value: string }
  /** `prefix`: the reference's prefix in capitals; absent for a plain number. */
  | { type: 'item_number'; value: number; prefix?: string };

/**
 * A reference whose digits do not fit `item_number` names no row. Answer 404
 * before the query: an integer cast of that value is a 500.
 */
function itemNumberOf(digits: string, expectedType: EntityType): number {
  const number = parseItemNumber(digits);
  if (number == null) {
    throw expectedType === 'incident' ? incidentNotFound() : new NotFoundException('Item not found');
  }
  return number;
}

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
    return { type: 'item_number', value: itemNumberOf(m[2], expectedType), prefix };
  }
  const other = raw.match(OTHER_REF_RE);
  if (other && ALSO_ACCEPTED_PREFIXES[expectedType]?.includes(other[1].toUpperCase())) {
    return { type: 'item_number', value: itemNumberOf(other[2], expectedType), prefix: other[1].toUpperCase() };
  }

  // Also accept plain numbers
  if (/^\d+$/.test(raw)) {
    return { type: 'item_number', value: itemNumberOf(raw, expectedType) };
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
 * The 404 for the UUID of a line of the other nature: what the type's routes answer for a line
 * that does not exist (the CAPEX routes' "CAPEX item not found", kept as before lot Z1).
 */
const OTHER_NATURE_NOT_FOUND: Partial<Record<EntityType, string>> = { spend: 'Item not found', capex: 'CAPEX item not found' };

/**
 * The 404 of an incident, missing or hidden from the reader (confidential) alike, with the code
 * the interface translates (`errors:INCIDENT_NOT_FOUND`).
 */
export function incidentNotFound(): NotFoundException {
  return new NotFoundException({ code: 'INCIDENT_NOT_FOUND', message: 'Incident not found' });
}

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
      if (other.length > 0) throw new NotFoundException(OTHER_NATURE_NOT_FOUND[entityType] ?? 'Item not found');
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
    technology: 'SELECT id FROM technologies WHERE tenant_id = app_current_tenant() AND item_number = $1 LIMIT 1',
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
    throw entityType === 'incident' ? incidentNotFound() : new NotFoundException('Item not found');
  }
  return rows[0].id;
}

/** The `spend_items` number a budget line reference names, one of the two (or neither for a name). */
export type BudgetLineReferenceNumbers = {
  /** The line's own number (`item_number`): a `BL-n` or a bare number. */
  itemNumber: number | null;
  /** The old number of its nature (`legacy_number`): an `OPX-n` or a `CPX-n`. */
  legacyNumber: string | null;
};

/**
 * The numbers a budget line reference names for a write: `BL-n` and a bare number are
 * `item_number`; `OPX-n` and `CPX-n` are only `legacy_number`. A name, or a malformed reference,
 * names neither. A read (`resolveBudgetLine`) takes the line number of an `OPX-n` or a `CPX-n`
 * first, and this legacy number when no line carries that number.
 */
export function budgetLineReferenceNumbers(raw: string): BudgetLineReferenceNumbers {
  const match = String(raw ?? '').match(/^(?:(BL|OPX|CPX)-)?(\d+)$/i);
  if (!match) return { itemNumber: null, legacyNumber: null };
  const number = parseItemNumber(match[2]);
  if (number == null) return { itemNumber: null, legacyNumber: null };
  const prefix = match[1]?.toUpperCase();
  return prefix && prefix !== 'BL'
    ? { itemNumber: null, legacyNumber: `${prefix}-${number}` }
    : { itemNumber: number, legacyNumber: null };
}

/** The line number written in an `OPX-n` or a `CPX-n`, the digits of the legacy form. */
function lineNumberOfLegacy(legacyNumber: string): number | null {
  return parseItemNumber(legacyNumber.slice(legacyNumber.indexOf('-') + 1));
}

/**
 * The line a budget reference names, of either nature, in the request's tenant. `BL-n` and a bare
 * number are the line's own number. `OPX-n` and `CPX-n` are that number first, then the legacy
 * number (`spend_items.legacy_number`), so the detail and the history name the same line.
 */
export async function resolveBudgetLine(raw: string, manager: EntityManager): Promise<{ id: string; nature: 'opex' | 'capex'; reference: string }> {
  let predicate: string;
  let params: unknown[];
  let order = '';
  if (UUID_RE.test(raw)) {
    predicate = 'id = $1';
    params = [raw];
  } else {
    const numbers = budgetLineReferenceNumbers(raw);
    if (numbers.itemNumber == null && numbers.legacyNumber == null) throw new BadRequestException('Malformed budget line reference');
    if (numbers.legacyNumber) {
      const itemNumber = lineNumberOfLegacy(numbers.legacyNumber);
      if (itemNumber == null) throw new BadRequestException('Malformed budget line reference');
      predicate = '(item_number = $1 OR legacy_number = $2)';
      params = [itemNumber, numbers.legacyNumber];
      order = 'ORDER BY (item_number = $1) DESC';
    } else {
      predicate = 'item_number = $1';
      params = [numbers.itemNumber];
    }
  }
  const [line] = await manager.query(
    `SELECT id, nature, item_number FROM spend_items
     WHERE tenant_id = app_current_tenant() AND nature IN ('opex', 'capex') AND ${predicate}
     ${order}
     LIMIT 1`,
    params,
  );
  if (!line) throw new NotFoundException('Budget line not found');
  return { id: line.id, nature: line.nature, reference: `BL-${line.item_number}` };
}
