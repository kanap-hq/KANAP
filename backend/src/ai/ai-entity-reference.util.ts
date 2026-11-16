import { NotFoundException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { isPaddedReferenceNumber, parseItemNumber } from '../common/parse-item-number';
import { budgetLineReference } from '../spend/budget-nature';
import type { AiContextEntityType, AiQueryEntityType, AiSearchEntityType } from './ai.types';

/** Any uuid shape (not only v1-v5). */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The business reference of each AI entity family that has one, and the tenant-scoped lookup that
 * finds its row. Static SQL only. Families missing here (business processes, accounts, ...) have no
 * reference. Budget lines (BL/OPX/CPX) and documents (DOC) are resolved by their own services.
 * A contract is read under the caller's data access: one out of reach is not found.
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
  suppliers: {
    pattern: /^SUP-?(\d+)$/i,
    sql: 'SELECT id FROM suppliers WHERE tenant_id = $1 AND item_number = $2 LIMIT 1',
    value: Number,
  },
  companies: {
    pattern: /^COMP-?(\d+)$/i,
    sql: 'SELECT id FROM companies WHERE tenant_id = $1 AND item_number = $2 LIMIT 1',
    value: Number,
  },
  contacts: {
    pattern: /^CTCT-?(\d+)$/i,
    sql: 'SELECT id FROM contacts WHERE tenant_id = $1 AND item_number = $2 LIMIT 1',
    value: Number,
  },
  departments: {
    pattern: /^DEPT-?(\d+)$/i,
    sql: 'SELECT id FROM departments WHERE tenant_id = $1 AND item_number = $2 LIMIT 1',
    value: Number,
  },
  contracts: {
    pattern: /^CTR-?(\d+)$/i,
    sql: 'SELECT id FROM contracts WHERE tenant_id = $1 AND item_number = $2 LIMIT 1',
    value: Number,
  },
};

/** The prefix of the families numbered by `item_number`, as `buildRef` writes their reference. */
const ITEM_NUMBER_PREFIXES: Readonly<Record<string, string>> = {
  projects: 'PRJ',
  requests: 'REQ',
  tasks: 'T',
  documents: 'DOC',
  incidents: 'INC',
  technologies: 'TEC',
  suppliers: 'SUP',
  companies: 'COMP',
  contacts: 'CTCT',
  departments: 'DEPT',
  contracts: 'CTR',
};

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

export function entityNotFound(entityType: string, value: string): NotFoundException {
  return new NotFoundException(`No ${entityType} record matches "${value}". Search for it first, then use its id or reference.`);
}

/**
 * Resolve an AI tool's `entity_id` to the row's uuid when it is a uuid or the family's business
 * reference (APP-1, AST-3, PRJ-12, REQ-7, T-42, INC-2, TEC-5, SUP-3, COMP-1, CTCT-2, DEPT-4, CTR-2), in the
 * caller's tenant. Returns null when
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
  // SUP-013 is no reference (an ERP ID is written so): the caller searches it as text.
  if (isPaddedReferenceNumber(ITEM_NUMBER_PREFIXES[entityType], number)) return null;
  const rows: Array<{ id: string }> = await manager.query(lookup.sql, [tenantId, lookup.value(number)]);
  if (rows.length === 0) throw entityNotFound(entityType, value);
  return String(rows[0].id);
}

/**
 * The business reference of a record from its item number (T-15, PRJ-3, DOC-2, BL-7...), for the
 * families that number their rows. Applications and assets carry theirs as text (`APP-4`, `AST-2`)
 * and are not built here.
 */
export function buildRef(type: AiSearchEntityType | AiContextEntityType | AiQueryEntityType, itemNumber?: number | null): string | null {
  if (!itemNumber) return null;
  if (type === 'budget_lines') return budgetLineReference(itemNumber);
  return familyReference(type, itemNumber);
}

/** The reference of a record of a family numbered by `item_number` (`SUP-3`), null for another family. */
export function familyReference(family: string, itemNumber: unknown): string | null {
  const prefix = ITEM_NUMBER_PREFIXES[family];
  const number = typeof itemNumber === 'number' ? itemNumber : Number(itemNumber);
  return prefix && itemNumber != null && Number.isSafeInteger(number) && number > 0 ? `${prefix}-${number}` : null;
}

/**
 * The record ids a business reference names in this tenant (T-15, PRJ-3, APP-4, DOC-2, BL-7, and
 * the other references the Activity column shows). A ticket number, a pasted id, or a reference
 * this workspace does not have names none, so the caller can still match the typed text itself.
 * A well-formed reference with no row is not an error. Every lookup is scoped by `tenant_id`.
 */
export async function resolveRecordIdsByReference(
  manager: Pick<EntityManager, 'query'>,
  tenantId: string,
  raw: string,
): Promise<string[]> {
  const value = String(raw ?? '').trim();
  if (!value || isUuid(value)) return [];
  const ids: string[] = [];
  for (const family of Object.keys(REFERENCE_LOOKUPS)) {
    if (!REFERENCE_LOOKUPS[family].pattern.test(value)) continue;
    try {
      const id = await resolveAiEntityReference(manager, tenantId, family, value);
      if (id) ids.push(id);
    } catch (error) {
      if (!(error instanceof NotFoundException)) throw error;
    }
  }
  const documentNumber = familyReferenceNumber('documents', value);
  if (documentNumber != null && documentNumber > 0) {
    const rows: Array<{ id: string }> = await manager.query(
      'SELECT id FROM documents WHERE tenant_id = $1 AND item_number = $2 LIMIT 1',
      [tenantId, documentNumber],
    );
    if (rows[0]?.id) ids.push(String(rows[0].id));
  }
  const lineMatch = value.match(/^BL-(\d+)$/i);
  const lineNumber = lineMatch ? parseItemNumber(lineMatch[1]) : null;
  if (lineNumber != null && lineNumber > 0) {
    const rows: Array<{ id: string }> = await manager.query(
      'SELECT id FROM spend_items WHERE tenant_id = $1 AND item_number = $2',
      [tenantId, lineNumber],
    );
    for (const row of rows) {
      if (row.id) ids.push(String(row.id));
    }
  }
  return ids;
}

/** The number a value names when it is the family's own reference (`SUP-3` for suppliers), else null (`SUP-013` too). */
export function familyReferenceNumber(family: string, value: string): number | null {
  const prefix = ITEM_NUMBER_PREFIXES[family];
  const match = prefix ? String(value ?? '').trim().match(/^([A-Z]+)-(\d+)$/i) : null;
  if (!match || match[1].toUpperCase() !== prefix || isPaddedReferenceNumber(prefix, match[2])) return null;
  return parseItemNumber(match[2]);
}
