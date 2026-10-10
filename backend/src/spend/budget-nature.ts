/**
 * The nature of a budget line, `spend_items.nature` (migration 1853950000000, plan
 * planning/budget-unifie.md, lot Z0): OPEX or CAPEX.
 *
 * `spend_items` will hold both natures (lot Z1 moves the CAPEX lines in). Until then every line
 * there is OPEX, and the rule holds already: the OPEX code never reads nor writes a line, nor a
 * version, month, attachment, link, contact or analytics value of a line, without the nature.
 * - Every statement that reads or locks `spend_items` names the nature (`natureAnd`, or
 *   `nature` in a TypeORM `where`).
 * - A route or function that starts from the id of a version, attachment, link or contact finds
 *   its line through `findBudgetLineOf` / `budgetLineOfChild` (`budget-locks.ts`), or through
 *   a lock that names the nature, before it reads anything else; a line or child of the other
 *   nature answers 404 there, as a line id does (`resolveToUuid`, `common/resolve-item-id.ts`).
 * - The other statements address children through the id of a line that went through one of
 *   these, and need no predicate of their own.
 *
 * The scope tables of `spend/` (`opex` / `capex` to table names) give their `opex` entry
 * `nature: 'opex'`; their `capex` entry points at the `capex_*` tables, which have no nature
 * column, until lot Z1.
 */
export type BudgetNature = 'opex' | 'capex';

/**
 * ` AND <alias>.nature = '<nature>'`: the nature predicate of a scope entry's line table, to
 * append to a predicate. Empty for an entry without a nature (a `capex_*` table). The value is
 * one of two constants, never the caller's input.
 */
export function natureAnd(alias: string | null, nature: BudgetNature | undefined): string {
  if (!nature) return '';
  if (nature !== 'opex' && nature !== 'capex') throw new Error(`Unknown budget line nature: ${String(nature)}`);
  return ` AND ${alias ? `${alias}.` : ''}nature = '${nature}'`;
}
