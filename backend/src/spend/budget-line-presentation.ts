import { EntityManager, ObjectLiteral, SelectQueryBuilder } from 'typeorm';
import { budgetLineReference, legacyNumberOf, type BudgetNature } from './budget-nature';
import { SpendItem } from './spend-item.entity';

/**
 * How a line of `spend_items` reads in the API and the audit log of its nature (plan
 * planning/budget-unifie.md, lot Z1, G.1, G.5, G.8).
 *
 * The CAPEX routes (`/capex-items*`, `/capex-versions*`) keep the contract they had on the
 * `capex_*` tables until the unified screens (lot U): a line's title is `description`, its number
 * is its CPX number (`legacy_number`), it has `ppe_type`, `investment_type` and `priority`, and
 * neither `product_name`, `contract_id` nor `nature`; its children name it `capex_item_id`. Every
 * line, of both natures, also gets `reference`, its neutral `BL-n`. The audit rows of a CAPEX line
 * keep that shape (without `reference`): the conflict and history readers find the field names of
 * before.
 *
 * The OPEX contract is unchanged, `reference` aside: the CAPEX columns are never selected for it
 * (`select: false` on the entity).
 */

/** The columns of a line the entity never selects (`select: false`), read for a CAPEX line. */
const HIDDEN_COLUMNS = ['legacy_number', 'ppe_type', 'investment_type', 'priority'] as const;

/** Adds the hidden columns a line of `nature` shows to a query on `SpendItem` (alias given). */
export function selectLineColumns<T extends ObjectLiteral>(qb: SelectQueryBuilder<T>, alias: string, nature: BudgetNature): SelectQueryBuilder<T> {
  return nature === 'capex' ? qb.addSelect(HIDDEN_COLUMNS.map((column) => `${alias}.${column}`)) : qb;
}

/** A line of the tenant of `nature` by id, with what its nature shows; null when missing or of the other nature. */
export async function findBudgetLine(manager: EntityManager, nature: BudgetNature, tenantId: string, id: string): Promise<SpendItem | null> {
  const qb = manager.getRepository(SpendItem).createQueryBuilder('i')
    .where('i.tenant_id = :tenantId AND i.id = :id AND i.nature = :nature', { tenantId, id, nature });
  return selectLineColumns(qb, 'i', nature).getOne();
}

/** The lines of the tenant of `nature` among `ids`, with what their nature shows (no order). */
export async function findBudgetLines(manager: EntityManager, nature: BudgetNature, tenantId: string, ids: readonly string[]): Promise<SpendItem[]> {
  if (ids.length === 0) return [];
  const qb = manager.getRepository(SpendItem).createQueryBuilder('i')
    .where('i.tenant_id = :tenantId AND i.id = ANY(:ids) AND i.nature = :nature', { tenantId, ids: Array.from(new Set(ids)), nature });
  return selectLineColumns(qb, 'i', nature).getMany();
}

type LineLike = Record<string, any>;
/** A line or child as its nature's API shows it. */
export type PresentedRow = Record<string, any> & { id: string };

/**
 * A line as its nature's API returns it, with `reference` (`BL-n`). Other keys (analytics fields,
 * references, the summary's derived fields) pass through.
 */
export function presentLine<T extends LineLike>(nature: BudgetNature, line: T): PresentedRow {
  return { ...auditLine(nature, line), reference: budgetLineReference(line.item_number) } as unknown as PresentedRow;
}

/** A line as its nature's audit rows record it: the API shape without `reference`. */
export function auditLine<T extends LineLike>(nature: BudgetNature, line: T): LineLike {
  if (!line) return line;
  const { legacy_number, ppe_type, investment_type, priority, reference, ...rest } = line;
  if (nature === 'opex') return rest;
  const { product_name, description, contract_id, nature: _nature, ...capex } = rest;
  void description;
  void contract_id;
  void _nature;
  return {
    ...capex,
    // The CAPEX line's number of before; its own number only for a line without one.
    item_number: legacyNumberOf('capex', legacy_number) ?? line.item_number,
    description: product_name,
    ppe_type,
    investment_type,
    priority,
  };
}

/** A child row (version, contact, web link, attachment) as its nature's API names its line. */
export function presentChild<T extends LineLike>(nature: BudgetNature, row: T): T & PresentedRow {
  if (nature === 'opex' || !row || typeof row !== 'object' || !('spend_item_id' in row)) return row as T & PresentedRow;
  const { spend_item_id, ...rest } = row;
  return { ...rest, capex_item_id: spend_item_id } as unknown as T & PresentedRow;
}

export function presentChildren<T extends LineLike>(nature: BudgetNature, rows: T[]): Array<T & PresentedRow> {
  return rows.map((row) => presentChild(nature, row));
}
